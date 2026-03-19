import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../new-actions');
const DATA_DIR = path.resolve(__dirname, '../public/data');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const PROJECTS_CONFIG = path.resolve(__dirname, '../projects.json');

interface ProjectConfig {
  name: string;
  repos: string[];
}

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
    
    // Load project config
    const repoToProject: Record<string, string> = {};
    if (fs.existsSync(PROJECTS_CONFIG)) {
      const config: ProjectConfig[] = await fs.readJson(PROJECTS_CONFIG);
      for (const project of config) {
        for (const repo of project.repos) {
          repoToProject[repo] = project.name;
        }
      }
      console.log(`Loaded ${config.length} projects with ${Object.keys(repoToProject).length} repos.`);
    }

    // projectsByMonth[YYYY-MM][projectName]
    const projectsByMonth: Record<string, Record<string, ProjectActivity>> = {};

    for (const filePath of files) {
      const rawContent = await fs.readFile(filePath, 'utf8');
      if (!rawContent.trim()) continue;

      let events: ActivityEvent[] = [];
      try {
        const parsed = JSON.parse(rawContent);
        events = Array.isArray(parsed) ? parsed : [parsed];
      } catch (e) {
        events = rawContent.split('\n')
          .filter(line => line.trim())
          .map(line => {
            try { return JSON.parse(line); } catch (err) { return null; }
          })
          .filter(ev => ev !== null);
      }

      for (const event of events) {
        let repoName = 'unknown';
        if (event.repo) {
          if (typeof event.repo === 'string') repoName = event.repo;
          else if (typeof event.repo === 'object' && event.repo.name) repoName = event.repo.name;
        }

        const projectName = repoToProject[repoName];
        if (!projectName) continue; // Only read data from projects and repos in the projects.json file

        let actor = 'unknown';
        if (event.actor) {
          if (typeof event.actor === 'string') actor = event.actor;
          else if (typeof event.actor === 'object' && (event.actor.login || event.actor.id)) {
            actor = event.actor.login || String(event.actor.id);
          }
        }

        const type = event.type || 'UnknownEvent';
        const timestamp = event.timestamp || event.created_at || new Date().toISOString();
        const date = new Date(timestamp);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        if (!projectsByMonth[monthKey]) projectsByMonth[monthKey] = {};
        if (!projectsByMonth[monthKey][projectName]) {
          projectsByMonth[monthKey][projectName] = { name: projectName, count: 0, repos: {}, activityTypes: {} };
        }

        const project = projectsByMonth[monthKey][projectName];
        project.count++;
        project.activityTypes[type] = (project.activityTypes[type] || 0) + 1;

        if (!project.repos[repoName]) {
          project.repos[repoName] = { 
            name: repoName, count: 0, users: {}, activityTypes: {}, events: []
          };
        }

        const repo = project.repos[repoName];
        repo.count++;
        repo.users[actor] = (repo.users[actor] || 0) + 1;
        repo.activityTypes[type] = (repo.activityTypes[type] || 0) + 1;
        repo.events.push({ t: timestamp, u: actor, tp: type });
      }
    }

    await fs.ensureDir(DATA_DIR);
    // Clear existing monthly files to avoid stale data
    const existingFiles = fs.readdirSync(DATA_DIR);
    for (const file of existingFiles) {
      if (file.match(/^\d{4}-\d{2}\.json$/)) {
        fs.unlinkSync(path.join(DATA_DIR, file));
      }
    }

    const availableMonths = Object.keys(projectsByMonth).sort();
    
    for (const monthKey of availableMonths) {
      const monthProjects = projectsByMonth[monthKey];
      const transformedProjects = Object.values(monthProjects).map(p => ({
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

      const monthFile = path.join(DATA_DIR, `${monthKey}.json`);
      await fs.writeJson(monthFile, { projects: transformedProjects }, { spaces: 0 });
      console.log(`Generated ${monthFile}`);
    }

    const index = {
      availableMonths,
      lastUpdated: new Date().toISOString()
    };
    await fs.writeJson(INDEX_FILE, index, { spaces: 2 });
    console.log(`Generated ${INDEX_FILE}`);

  } catch (error) {
    console.error('Aggregation failed:', error);
    process.exit(1);
  }
}

aggregate();
