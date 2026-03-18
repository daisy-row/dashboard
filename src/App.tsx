import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { 
  Search, RefreshCw, Layers, GitBranch, Users, ArrowLeft, ExternalLink, Activity, Calendar, AlertCircle
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ActivityType {
  name: string;
  count: number;
}

interface UserActivity {
  name: string;
  count: number;
}

interface RawEvent {
  t: string; // timestamp
  u: string; // user
  tp: string; // type
}

interface RepoActivity {
  name: string;
  count: number;
  users: UserActivity[];
  activityTypes: ActivityType[];
  events: RawEvent[];
}

interface ProjectActivity {
  name: string;
  count: number;
  repos: RepoActivity[];
  activityTypes: ActivityType[];
}

interface DataIndex {
  availableMonths: string[];
  lastUpdated: string;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f43f5e'];

const App: React.FC = () => {
  const [dataIndex, setDataIndex] = useState<DataIndex | null>(null);
  const [loadedMonths, setLoadedMonths] = useState<Record<string, ProjectActivity[]>>({});
  const [loading, setLoading] = useState(false);
  const [selectedProjectName, setSelectedProjectName] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchIndex = async () => {
    try {
      const response = await axios.get('./data/index.json');
      setDataIndex(response.data);
      // Load most recent month by default
      if (response.data.availableMonths.length > 0) {
        const latestMonth = response.data.availableMonths[response.data.availableMonths.length - 1];
        loadMonth(latestMonth);
      }
    } catch (err) {
      console.error('Error fetching data index:', err);
      setError('Failed to load data index. Please check if the site is still building.');
    }
  };

  const loadMonth = async (monthKey: string) => {
    if (loadedMonths[monthKey]) return;
    
    setLoading(true);
    try {
      const response = await axios.get(`./data/${monthKey}.json`);
      setLoadedMonths(prev => ({ ...prev, [monthKey]: response.data.projects }));
    } catch (err) {
      console.error(`Error loading month ${monthKey}:`, err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIndex();
  }, []);

  // When dates change, check if we need to load more months
  useEffect(() => {
    if (!dataIndex || (!startDate && !endDate)) return;

    const start = startDate ? new Date(startDate) : new Date(0);
    const end = endDate ? new Date(endDate) : new Date();

    const monthsToLoad = dataIndex.availableMonths.filter(monthKey => {
      const [year, month] = monthKey.split('-').map(Number);
      const monthStart = new Date(year, month - 1, 1);
      const monthEnd = new Date(year, month, 0, 23, 59, 59);
      
      return (monthStart <= end && monthEnd >= start);
    });

    monthsToLoad.forEach(loadMonth);
  }, [startDate, endDate, dataIndex]);

  const rawProjects = useMemo(() => {
    // Merge all loaded months
    const projectMap: Record<string, ProjectActivity> = {};

    Object.values(loadedMonths).flat().forEach(monthProj => {
      if (!projectMap[monthProj.name]) {
        // Clone to avoid mutating state
        projectMap[monthProj.name] = { 
          name: monthProj.name, 
          count: 0, 
          repos: [], 
          activityTypes: [] 
        };
      }

      const proj = projectMap[monthProj.name];
      proj.count += monthProj.count;
      
      // Merge repos
      monthProj.repos.forEach(monthRepo => {
        let repo = proj.repos.find(r => r.name === monthRepo.name);
        if (!repo) {
          repo = { name: monthRepo.name, count: 0, users: [], activityTypes: [], events: [] };
          proj.repos.push(repo);
        }
        repo.count += monthRepo.count;
        repo.events.push(...monthRepo.events);
      });
    });

    return Object.values(projectMap);
  }, [loadedMonths]);

  const processedData = useMemo(() => {
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    return rawProjects.map(project => {
      const filteredRepos = project.repos.map(repo => {
        const filteredEvents = repo.events.filter(e => {
          const d = new Date(e.t);
          if (start && d < start) return false;
          if (end && d > end) return false;
          return true;
        });

        if (filteredEvents.length === 0 && (start || end)) {
          return null;
        }

        const userMap: Record<string, number> = {};
        const typeMap: Record<string, number> = {};
        filteredEvents.forEach(e => {
          userMap[e.u] = (userMap[e.u] || 0) + 1;
          typeMap[e.tp] = (typeMap[e.tp] || 0) + 1;
        });

        return {
          ...repo,
          count: filteredEvents.length,
          users: Object.entries(userMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
          activityTypes: Object.entries(typeMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
        };
      }).filter(Boolean) as RepoActivity[];

      const totalCount = filteredRepos.reduce((acc, r) => acc + r.count, 0);
      
      const projectTypeMap: Record<string, number> = {};
      filteredRepos.forEach(r => {
        r.activityTypes.forEach(t => {
          projectTypeMap[t.name] = (projectTypeMap[t.name] || 0) + t.count;
        });
      });

      return {
        ...project,
        count: totalCount,
        repos: filteredRepos.sort((a, b) => b.count - a.count),
        activityTypes: Object.entries(projectTypeMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
      };
    }).filter(p => p.count > 0 && p.name.toLowerCase().includes(searchTerm.toLowerCase()))
      .sort((a, b) => b.count - a.count);
  }, [rawProjects, startDate, endDate, searchTerm]);

  const selectedProject = useMemo(() => 
    processedData.find(p => p.name === selectedProjectName) || null
  , [processedData, selectedProjectName]);

  const totalActivity = useMemo(() => 
    processedData.reduce((acc, p) => acc + p.count, 0)
  , [processedData]);

  if (selectedProject) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <button 
          onClick={() => setSelectedProjectName(null)}
          className="flex items-center text-blue-600 hover:text-blue-800 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Dashboard
        </button>

        <div className="bg-white rounded-xl shadow-sm p-8 border border-gray-100">
          <div className="flex justify-between items-start mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 capitalize mb-2">{selectedProject.name} Project</h1>
              <p className="text-gray-500 flex items-center">
                <Activity className="w-4 h-4 mr-2" />
                Total Activity: {selectedProject.count} events
              </p>
            </div>
            {dataIndex?.lastUpdated && (
              <div className="text-xs text-gray-400">
                Data last updated: {new Date(dataIndex.lastUpdated).toLocaleString()}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
            <div className="bg-gray-50 rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center">
                <GitBranch className="w-5 h-5 mr-2 text-blue-500" />
                Activity per Repo
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={selectedProject.repos.slice(0, 10)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" />
                    <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center">
                <Activity className="w-5 h-5 mr-2 text-purple-500" />
                Activity Types
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={selectedProject.activityTypes}
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="count"
                    >
                      {selectedProject.activityTypes.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend verticalAlign="bottom" height={36}/>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center">
                <Users className="w-5 h-5 mr-2 text-green-500" />
                Top Contributors
              </h3>
              <div className="space-y-3 max-h-64 overflow-y-auto pr-2 text-sm">
                {selectedProject.repos.flatMap(r => r.users)
                  .reduce((acc: UserActivity[], u) => {
                    const existing = acc.find(x => x.name === u.name);
                    if (existing) existing.count += u.count;
                    else acc.push({ ...u });
                    return acc;
                  }, [])
                  .sort((a, b) => b.count - a.count)
                  .slice(0, 10)
                  .map((user, i) => (
                    <div key={i} className="flex justify-between items-center bg-white p-2 rounded-md shadow-sm border border-gray-100">
                      <span className="font-medium text-gray-700 truncate mr-2">{user.name}</span>
                      <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap">
                        {user.count}
                      </span>
                    </div>
                  ))
                }
              </div>
            </div>
          </div>

          <h3 className="text-xl font-bold mb-4 mt-8">Repository Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {selectedProject.repos.map((repo, i) => (
              <div key={i} className="border border-gray-100 rounded-lg p-5 hover:shadow-md transition-all bg-white">
                <h4 className="font-bold text-gray-900 mb-3 flex items-center truncate border-b border-gray-50 pb-2">
                  <ExternalLink className="w-4 h-4 mr-2 text-gray-400" />
                  {repo.name}
                </h4>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase mb-2 tracking-wider">Activity Types</p>
                    <div className="space-y-1">
                      {repo.activityTypes.slice(0, 5).map((t, j) => (
                        <div key={j} className="flex justify-between text-[11px] py-0.5 border-b border-gray-50 last:border-0">
                          <span className="text-gray-600 truncate mr-1">{t.name.replace('Event', '')}</span>
                          <span className="font-bold text-gray-900">{t.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase mb-2 tracking-wider">Top Users</p>
                    <div className="space-y-1">
                      {repo.users.slice(0, 5).map((u, j) => (
                        <div key={j} className="flex justify-between text-[11px] py-0.5 border-b border-gray-50 last:border-0">
                          <span className="text-gray-600 truncate mr-1">{u.name}</span>
                          <span className="font-bold text-gray-900">{u.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Activity className="text-white w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Project Activity Dashboard</h1>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center bg-gray-100 rounded-lg p-1 space-x-1">
              <div className="relative">
                <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 w-3 h-3" />
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="pl-7 pr-2 py-1 bg-transparent border-none text-xs focus:ring-0 outline-none w-32"
                />
              </div>
              <span className="text-gray-400 text-xs">to</span>
              <div className="relative">
                <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 w-3 h-3" />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="pl-7 pr-2 py-1 bg-transparent border-none text-xs focus:ring-0 outline-none w-32"
                />
              </div>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Filter projects..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 bg-gray-100 border-transparent focus:bg-white focus:ring-2 focus:ring-blue-500 rounded-lg text-sm transition-all outline-none w-48"
              />
            </div>
            <button 
              onClick={fetchIndex}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center transition-colors shadow-sm"
            >
              <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-8 flex items-start">
            <AlertCircle className="text-red-400 w-5 h-5 mr-3 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">Total Projects</span>
              <Layers className="text-blue-500 w-5 h-5" />
            </div>
            <div className="text-2xl font-bold">{processedData.length}</div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">Total Activity</span>
              <Activity className="text-green-500 w-5 h-5" />
            </div>
            <div className="text-2xl font-bold">{totalActivity.toLocaleString()}</div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">Months Loaded</span>
              <Calendar className="text-yellow-500 w-5 h-5" />
            </div>
            <div className="text-2xl font-bold">
              {Object.keys(loadedMonths).length} / {dataIndex?.availableMonths.length || 0}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 mb-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-bold text-gray-900">Activity Distribution by Project</h2>
            {loading && <div className="text-xs text-blue-500 animate-pulse">Loading more data...</div>}
          </div>
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={processedData.slice(0, 20)}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-45} textAnchor="end" height={80} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} onClick={(p) => setSelectedProjectName((p as any).name)} cursor="pointer" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {processedData.map((project, i) => (
            <div 
              key={i} 
              onClick={() => setSelectedProjectName(project.name)}
              className="bg-white border border-gray-100 rounded-xl p-6 hover:border-blue-300 hover:shadow-lg transition-all cursor-pointer group"
            >
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-lg font-bold text-gray-900 capitalize group-hover:text-blue-600 transition-colors truncate pr-4">
                  {project.name}
                </h3>
                <span className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-xs font-bold">
                  {project.count} events
                </span>
              </div>
              
              <div className="space-y-3">
                <div className="flex justify-between text-sm text-gray-500 border-b border-gray-50 pb-2">
                  <span className="flex items-center">
                    <GitBranch className="w-4 h-4 mr-2" />
                    Repos
                  </span>
                  <span className="font-semibold text-gray-900">{project.repos.length}</span>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Top Repo</p>
                  <div className="text-sm font-medium text-gray-700 truncate">
                    {project.repos[0]?.name || 'N/A'}
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
                    <div 
                      className="bg-blue-500 h-1.5 rounded-full" 
                      style={{ width: `${project.repos[0] ? (project.repos[0].count / project.count) * 100 : 0}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};

export default App;
