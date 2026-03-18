import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../ghe/new-actions');
const OUTPUT_FILE = path.resolve(__dirname, '../public/data.json');

interface ActivityEvent {
  action: string;
  actor: string;
  repo: string;
  type: string;
  timestamp: string;
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
    
    if (files.length > 0) {
      console.log('First 3 files:', files.slice(0, 3));
    }

    const projects: Record<string, ProjectActivity> = {};

    for (const filePath of files) {
      const relativePath = path.relative(ROOT_DIR, filePath);
      const parts = relativePath.split(path.sep);
      if (parts.length < 2) continue;
      
      const projectName = parts[0].replace('-actions', '');
      
      if (!projects[projectName]) {
        projects[projectName] = { name: projectName, count: 0, repos: {}, activityTypes: {} };
      }

      const content = await fs.readJson(filePath);
      const events: ActivityEvent[] = Array.isArray(content) ? content : [];

      projects[projectName].count += events.length;

      for (const event of events) {
        const repoName = event.repo;
        const actor = event.actor;
        const type = event.type;
        const timestamp = event.timestamp;

        if (!projects[projectName].repos[repoName]) {
          projects[projectName].repos[repoName] = { 
            name: repoName, 
            count: 0, 
            users: {}, 
            activityTypes: {},
            events: []
          };
        }

        const repo = projects[projectName].repos[repoName];
        repo.count++;
        repo.users[actor] = (repo.users[actor] || 0) + 1;
        repo.activityTypes[type] = (repo.activityTypes[type] || 0) + 1;
        repo.events.push({ t: timestamp, u: actor, tp: type });
        
        projects[projectName].activityTypes[type] = (projects[projectName].activityTypes[type] || 0) + 1;
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
