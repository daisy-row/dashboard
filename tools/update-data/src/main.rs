//! Export GitHub events for every org in repos.json from the postgres
//! server configured in ./setup into new-actions/YYYY/YYYY-MM-DD.json
//! (one JSON event per line, same shape as the 2026 files), then rebuild
//! public/data via the aggregator.
//!
//! Events are matched by org_id (indexed) rather than repo name, so
//! renamed and deleted repos under the orgs are included too; the
//! aggregator's projects.json is the final filter for the dashboard.
//!
//! usage: update-data [START [END]]   (dates inclusive, default 2014-01-01..today)

use chrono::{DateTime, Datelike, NaiveDate, Utc};
use postgres::fallible_iterator::FallibleIterator;
use postgres::types::ToSql;
use postgres::{Client, NoTls};
use serde_json::json;
use std::collections::HashMap;
use std::error::Error;
use std::fs;
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::process::Command;

const ACTIONS_DIR: &str = "new-actions";
const REPOS_FILE: &str = "repos.json";

type Result<T> = std::result::Result<T, Box<dyn Error>>;

fn database_url() -> Result<String> {
    if let Ok(url) = std::env::var("DATABASE_URL") {
        return Ok(url);
    }
    let setup = fs::read_to_string("setup")?;
    for line in setup.lines() {
        if let Some(rest) = line.trim().strip_prefix("export DATABASE_URL=") {
            return Ok(rest.trim_matches(|c| c == '\'' || c == '"').to_string());
        }
    }
    Err("no DATABASE_URL in environment or ./setup".into())
}

fn org_logins() -> Result<Vec<String>> {
    let repos: serde_json::Value = serde_json::from_str(&fs::read_to_string(REPOS_FILE)?)?;
    let mut logins: Vec<String> = repos
        .as_array()
        .ok_or("repos.json: expected an array")?
        .iter()
        .flat_map(|e| e["orgs"].as_array().into_iter().flatten())
        .filter_map(|o| o["org"].as_str())
        .map(|s| s.to_lowercase())
        .collect();
    logins.sort();
    logins.dedup();
    Ok(logins)
}

fn day_file(day: NaiveDate) -> PathBuf {
    PathBuf::from(format!("{ACTIONS_DIR}/{}/{}.json", day.year(), day))
}

fn utc_midnight(day: NaiveDate) -> DateTime<Utc> {
    day.and_hms_opt(0, 0, 0).unwrap().and_utc()
}

fn export_chunk(
    client: &mut Client,
    orgs: &HashMap<i64, String>,
    start: NaiveDate,
    end: NaiveDate,
) -> Result<u64> {
    // Materialize the chunk's events first so the planner has real row
    // counts and resolves repo/actor names via their PK indexes instead
    // of seq-scanning those (very large) tables. CREATE TABLE AS cannot
    // take bind parameters; everything inlined here is generated, not
    // user input.
    let org_list = orgs.keys().map(i64::to_string).collect::<Vec<_>>().join(",");
    client.batch_execute(&format!(
        "DROP TABLE IF EXISTS ev;
         CREATE TEMP TABLE ev AS
           SELECT e.event_id, e.type, e.actor_id, e.repo_id, e.org_id, e.created_at
           FROM events e
           WHERE e.org_id IN ({org_list})
             AND e.created_at >= '{}'::timestamptz
             AND e.created_at < '{}'::timestamptz;
         ANALYZE ev;",
        utc_midnight(start).to_rfc3339(),
        utc_midnight(end + chrono::Days::new(1)).to_rfc3339(),
    ))?;

    let mut rows = client.query_raw(
        "SELECT e.event_id, e.type, e.created_at, e.actor_id, a.login, a.display_login,
                e.repo_id, r.name, e.org_id
         FROM ev e
         LEFT JOIN repositories r ON r.repo_id = e.repo_id
         LEFT JOIN actors a ON a.actor_id = e.actor_id
         ORDER BY e.created_at",
        std::iter::empty::<&dyn ToSql>(),
    )?;

    let mut current: Option<(NaiveDate, BufWriter<fs::File>)> = None;
    let mut count = 0u64;
    while let Some(row) = rows.next()? {
        let event_id: i64 = row.get(0);
        let event_type: &str = row.get(1);
        let created_at: DateTime<Utc> = row.get(2);
        let actor_id: Option<i64> = row.get(3);
        let login: Option<&str> = row.get(4);
        let display_login: Option<&str> = row.get(5);
        let repo_id: Option<i64> = row.get(6);
        let repo_name: Option<&str> = row.get(7);
        let org_id: i64 = row.get(8);

        let day = created_at.date_naive();
        if current.as_ref().map(|(d, _)| *d) != Some(day) {
            current = Some((day, BufWriter::new(fs::File::create(day_file(day))?)));
        }

        let actor_fallback;
        let login = match (login, actor_id) {
            (Some(l), _) => l,
            (None, Some(id)) => {
                actor_fallback = id.to_string();
                &actor_fallback
            }
            (None, None) => "unknown",
        };
        let event = json!({
            "id": event_id.to_string(),
            "type": event_type,
            "created_at": created_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
            "actor": { "id": actor_id, "login": login, "display_login": display_login },
            "repo": { "id": repo_id, "name": repo_name.unwrap_or("unknown") },
            "org": { "id": org_id, "login": orgs[&org_id] },
        });
        let (_, writer) = current.as_mut().unwrap();
        serde_json::to_writer(&mut *writer, &event)?;
        writer.write_all(b"\n")?;
        count += 1;
    }
    Ok(count)
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let start: NaiveDate = args.first().map_or("2014-01-01", |s| s).parse()?;
    let end: NaiveDate = match args.get(1) {
        Some(s) => s.parse()?,
        None => Utc::now().date_naive(),
    };
    if end < start {
        return Err(format!("end {end} is before start {start}").into());
    }

    let mut client = Client::connect(&database_url()?, NoTls)?;

    let logins = org_logins()?;
    println!("resolving org ids for {} orgs...", logins.len());
    let orgs: HashMap<i64, String> = client
        .query(
            "SELECT org_id, login FROM organizations WHERE lower(login) = ANY($1)",
            &[&logins],
        )?
        .iter()
        .map(|row| (row.get(0), row.get(1)))
        .collect();
    println!("{} orgs known to the database", orgs.len());

    // Remove existing day files in the range so days that no longer have
    // events do not keep stale data, and make sure the year dirs exist.
    for year in start.year()..=end.year() {
        fs::create_dir_all(format!("{ACTIONS_DIR}/{year}"))?;
    }
    for day in start.iter_days().take_while(|d| *d <= end) {
        match fs::remove_file(day_file(day)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
            _ => {}
        }
    }

    // Export one year at a time for progress and easy retries.
    for year in start.year()..=end.year() {
        let chunk_start = start.max(NaiveDate::from_ymd_opt(year, 1, 1).unwrap());
        let chunk_end = end.min(NaiveDate::from_ymd_opt(year, 12, 31).unwrap());
        println!("exporting {chunk_start}..{chunk_end}");
        let count = export_chunk(&mut client, &orgs, chunk_start, chunk_end)?;
        println!("  {count} events");
    }

    let status = Command::new("npm").args(["run", "aggregate"]).status()?;
    if !status.success() {
        return Err("npm run aggregate failed".into());
    }
    Ok(())
}
