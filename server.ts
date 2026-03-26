import express from 'express';
import cors from 'cors';
import { glob } from 'glob';
import fs from 'fs-extra';
import path from 'path';

const app = express();
const PORT = 3001;
const BLOCK_CONFIG = path.resolve(__dirname, 'block.json');

app.use(cors());
app.use(express.json());

interface ActivityEvent {
  action: string;
  actor: string;
  repo: string;
  type: string;
  timestamp: string;
}

interface UserActivity {
  name: string;
  count: number;
}

interface RepoActivity {
  name: string;
  count: number;
  users: Record<string, number>;
  activityTypes: Record<string, number>;
}

interface ProjectActivity {
  name: string;
  count: number;
  repos: Record<string, RepoActivity>;
  activityTypes: Record<string, number>;
}

app.get('/api/activity', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate as string) : null;
    const end = endDate ? new Date(endDate as string) : null;

    console.log(`Scanning files with range: ${startDate || 'any'} to ${endDate || 'any'}...`);
    const files = await glob('../*-actions/*.json');
    const projects: Record<string, ProjectActivity> = {};

    // Load blocked actors
    const blockedActors = new Set<string>();
    if (fs.existsSync(BLOCK_CONFIG)) {
      const blocked: string[] = await fs.readJson(BLOCK_CONFIG);
      for (const actor of blocked) {
        blockedActors.add(actor);
      }
    }

    for (const file of files) {
      const projectName = path.dirname(file).split(path.sep).pop()!.replace('-actions', '');

      if (!projects[projectName]) {
        projects[projectName] = { name: projectName, count: 0, repos: {}, activityTypes: {} };
      }

      const content = await fs.readJson(file);
      const allEvents: ActivityEvent[] = Array.isArray(content) ? content : [];

      // Filter events by date if provided
      const events = allEvents.filter(event => {
        if (!event.timestamp) return true;
        const eventDate = new Date(event.timestamp);
        if (start && eventDate < start) return false;
        if (end && eventDate > end) return false;
        return true;
      });

      if (events.length === 0) continue;

      projects[projectName].count += events.length;


      for (const event of events) {
        const repoName = event.repo;
        const actor = event.actor;
        const type = event.type;

        if (blockedActors.has(actor)) continue;

        if (!projects[projectName].repos[repoName]) {
          projects[projectName].repos[repoName] = { name: repoName, count: 0, users: {}, activityTypes: {} };
        }

        projects[projectName].repos[repoName].count++;
        projects[projectName].repos[repoName].users[actor] = (projects[projectName].repos[repoName].users[actor] || 0) + 1;
        
        // Track types at repo level
        projects[projectName].repos[repoName].activityTypes[type] = (projects[projectName].repos[repoName].activityTypes[type] || 0) + 1;
        
        // Track types at project level
        projects[projectName].activityTypes[type] = (projects[projectName].activityTypes[type] || 0) + 1;
      }
    }

    // Transform to array for easier frontend consumption
    const result = Object.values(projects).map((p: ProjectActivity) => ({
      ...p,
      activityTypes: Object.entries(p.activityTypes).map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      repos: Object.values(p.repos).map((r: RepoActivity) => ({
        ...r,
        activityTypes: Object.entries(r.activityTypes).map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
        users: Object.entries(r.users).map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
      })).sort((a, b) => b.count - a.count)
    })).sort((a, b) => b.count - a.count);

    res.json(result);
  } catch (error) {
    console.error('Error scanning files:', error);
    res.status(500).json({ error: 'Failed to scan activity' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
