import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../new-actions');
const OUTPUT_FILE = path.resolve(__dirname, '../public/data.json');

interface ActivityEvent {
  action?: string;
  actor: any;
  repo: any;
  type: string;
  timestamp?: string;
  created_at?: string;
  org?: any;
}

interface RepoActivity {
  name: string;
  count: number;
  users: Record<string, number>;
  activityTypes: Record<string, number>;
  events: { t: string; u: string; tp: string }[];
}

interface ProjectActivity {
  name: string;
  count: number;
  repos: Record<string, RepoActivity>;
  activityTypes: Record<string, number>;
}

function getAllFiles(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getAllFiles(filePath, fileList);
    } else if (file.endsWith('.json')) {
      fileList.push(filePath);
    }
  });
  return fileList;
}

async function aggregate() {
  try {
    console.log('Scanning directory:', ROOT_DIR);
    if (!fs.existsSync(ROOT_DIR)) {
      throw new Error(`Directory ${ROOT_DIR} does not exist`);
    }

    const files = getAllFiles(ROOT_DIR);
    console.log(`Found ${files.length} files. Aggregating...`);
    
    const projects: Record<string, ProjectActivity> = {};

    for (const filePath of files) {
      const rawContent = await fs.readFile(filePath, 'utf8');
      if (!rawContent.trim()) continue;

      let events: ActivityEvent[] = [];
      
      // Try parsing as standard JSON
      try {
        const parsed = JSON.parse(rawContent);
        events = Array.isArray(parsed) ? parsed : [parsed];
      } catch (e) {
        // Try parsing as NDJSON
        events = rawContent.split('\n')
          .filter(line => line.trim())
          .map(line => {
            try {
              return JSON.parse(line);
            } catch (err) {
              return null;
            }
          })
          .filter(ev => ev !== null);
      }

      const relativePath = path.relative(ROOT_DIR, filePath);
      const parts = relativePath.split(path.sep);
      
      // Determine project name from directory if it looks like the old structure
      let defaultProjectName = parts.length >= 2 && parts[0].endsWith('-actions') 
        ? parts[0].replace('-actions', '') 
        : null;

      for (const event of events) {
        // Extract project name
        let projectName = defaultProjectName;
        if (!projectName && event.org && typeof event.org === 'object' && event.org.login) {
          projectName = event.org.login;
        } else if (!projectName && event.org && typeof event.org === 'string') {
          projectName = event.org;
        }
        
        if (!projectName) projectName = 'other';

        // Extract repo name
        let repoName = 'unknown';
        if (event.repo) {
          if (typeof event.repo === 'string') repoName = event.repo;
          else if (typeof event.repo === 'object' && event.repo.name) repoName = event.repo.name;
        }

        // Extract actor
        let actor = 'unknown';
        if (event.actor) {
          if (typeof event.actor === 'string') actor = event.actor;
          else if (typeof event.actor === 'object' && (event.actor.login || event.actor.id)) {
            actor = event.actor.login || String(event.actor.id);
          }
        }

        // Extract type and timestamp
        const type = event.type || 'UnknownEvent';
        const timestamp = event.timestamp || event.created_at || new Date().toISOString();

        if (!projects[projectName]) {
          projects[projectName] = { name: projectName, count: 0, repos: {}, activityTypes: {} };
        }

        const project = projects[projectName];
        project.count++;
        project.activityTypes[type] = (project.activityTypes[type] || 0) + 1;

        if (!project.repos[repoName]) {
          project.repos[repoName] = { 
            name: repoName, 
            count: 0, 
            users: {}, 
            activityTypes: {},
            events: []
          };
        }

        const repo = project.repos[repoName];
        repo.count++;
        repo.users[actor] = (repo.users[actor] || 0) + 1;
        repo.activityTypes[type] = (repo.activityTypes[type] || 0) + 1;
        
        // Only keep events if we need them for filtering in the UI
        // Limiting to keep data.json size manageable if needed, but for now keeping them
        repo.events.push({ t: timestamp, u: actor, tp: type });
      }
    }

    const transformedProjects = Object.values(projects).map(p => ({
      ...p,
      activityTypes: Object.entries(p.activityTypes).map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      repos: Object.values(p.repos).map(r => ({
        ...r,
        activityTypes: Object.entries(r.activityTypes).map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
        users: Object.entries(r.users).map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
      })).sort((a, b) => b.count - a.count)
    })).sort((a, b) => b.count - a.count);

    const result = {
      projects: transformedProjects,
      lastUpdated: new Date().toISOString()
    };

    await fs.ensureDir(path.dirname(OUTPUT_FILE));
    await fs.writeJson(OUTPUT_FILE, result, { spaces: 0 });
    console.log(`Successfully generated ${OUTPUT_FILE} (${Math.round(JSON.stringify(result).length / 1024)} KB)`);
  } catch (error) {
    console.error('Aggregation failed:', error);
    process.exit(1);
  }
}

aggregate();
