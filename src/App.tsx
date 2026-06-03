import { useState, useEffect, useRef } from "react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Define custom invoke wrapper to transparently support both Tauri desktop and standard browsers
const invoke = async <T = any>(cmd: string, args: any = {}): Promise<T> => {
  if (typeof window !== "undefined" && ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__)) {
    // Tauri Desktop Environment
    return await tauriInvoke(cmd, args);
  } else {
    // Standard Browser Environment (Remote Client)
    const host = localStorage.getItem("aide_host") || window.location.host;
    const password = localStorage.getItem("aide_password") || "";
    
    const res = await fetch(`http://${host}/api/invoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${password}`,
        "X-Aide-Password": password
      },
      body: JSON.stringify({ cmd, args })
    });

    if (!res.ok) {
      if (res.status === 401) {
        throw new Error("Unauthorized: Invalid access password");
      }
      throw new Error(await res.text());
    }

    const data = await res.json();
    if (data.error) {
      throw new Error(data.error);
    }
    return data.result;
  }
};
import "./App.css";

interface TerminalLine {
  text: string;
  type: "stdout" | "stderr" | "system";
  timestamp: string;
}

interface ProcessOutputPayload {
  agent_id: string;
  stream_type: "stdout" | "stderr";
  content: string;
}

interface AgentTemplate {
  id: string;
  name: string;
  category: "built-in" | "preset" | "acp" | "custom";
  recommendedPath: string;
  recommendedArgs: string;
  recommendedEnvKey: string;
  recommendedEnvVal: string;
  description: string;
  title: string;
}

const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "claude-code",
    name: "Claude",
    category: "built-in",
    recommendedPath: "claude",
    recommendedArgs: "-v",
    recommendedEnvKey: "ANTHROPIC_API_KEY",
    recommendedEnvVal: "",
    description: "Anthropic Claude Code 运行时，卓越的终端 AI 交互特助",
    title: "Anthropic Claude Code 运行时"
  },
  {
    id: "codex-code",
    name: "Codex",
    category: "built-in",
    recommendedPath: "codex-cli",
    recommendedArgs: "-v",
    recommendedEnvKey: "CODEX_API_KEY",
    recommendedEnvVal: "",
    description: "OpenAI Codex 智能开发特助，精通多语言代码生成",
    title: "OpenAI Codex 开发时"
  },
  {
    id: "deepseek-claude",
    name: "DeepSeek over Claude Code",
    category: "preset",
    recommendedPath: "claude",
    recommendedArgs: "-v",
    recommendedEnvKey: "DEEPSEEK_API_KEY",
    recommendedEnvVal: "",
    description: "通过 Claude Code 终端运行 DeepSeek 深度推理模型",
    title: "DeepSeek Coder 预设运行时"
  },
  {
    id: "mimo-claude",
    name: "MiMo over Claude Code",
    category: "preset",
    recommendedPath: "claude",
    recommendedArgs: "-v",
    recommendedEnvKey: "MIMO_API_KEY",
    recommendedEnvVal: "",
    description: "通过 Claude Code 终端运行 MiMo 专家级编程大模型",
    title: "MiMo Coder 预设运行时"
  },
  {
    id: "agoragentic",
    name: "Agoragentic",
    category: "acp",
    recommendedPath: "agoragentic",
    recommendedArgs: "-v",
    recommendedEnvKey: "AGORA_API_KEY",
    recommendedEnvVal: "",
    description: "去中心化多 Agent 协商与协作网络 ACP 客户端",
    title: "Agoragentic 运行时"
  },
  {
    id: "amp",
    name: "Amp",
    category: "acp",
    recommendedPath: "amp",
    recommendedArgs: "-v",
    recommendedEnvKey: "AMP_API_KEY",
    recommendedEnvVal: "",
    description: "高并发终端微智能体开发与分发包工具",
    title: "Amp 智能微型体运行时"
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    category: "acp",
    recommendedPath: "gemini",
    recommendedArgs: "-v",
    recommendedEnvKey: "GEMINI_API_KEY",
    recommendedEnvVal: "",
    description: "Google Gemini CLI 官方终端智能特助，提供强大的多模态与 ACP 协同能力",
    title: "Google Gemini CLI 运行时"
  },
  {
    id: "auggie-cli",
    name: "Auggie CLI",
    category: "acp",
    recommendedPath: "auggie",
    recommendedArgs: "-v",
    recommendedEnvKey: "AUGGIE_API_KEY",
    recommendedEnvVal: "",
    description: "增强型代码重构与安全审计智能体命令行",
    title: "Auggie 静态审计运行时"
  },
  {
    id: "autohand-code",
    name: "Autohand Code",
    category: "acp",
    recommendedPath: "autohand-code",
    recommendedArgs: "-v",
    recommendedEnvKey: "AUTOHAND_API_KEY",
    recommendedEnvVal: "",
    description: "自动化代码修改与项目构建全流程智能体",
    title: "Autohand 自动修改运行时"
  },
  {
    id: "cline-code",
    name: "Cline",
    category: "acp",
    recommendedPath: "cline-cli",
    recommendedArgs: "-v",
    recommendedEnvKey: "CLINE_API_KEY",
    recommendedEnvVal: "",
    description: "基于 VS Code 开放指令的高吞吐量自主开发智能体",
    title: "Cline 智能代理运行时"
  },
  {
    id: "codebuddy-code",
    name: "Codebuddy Code",
    category: "acp",
    recommendedPath: "codebuddy",
    recommendedArgs: "-v",
    recommendedEnvKey: "CODEBUDDY_API_KEY",
    recommendedEnvVal: "",
    description: "全能型开发伴侣，提供代码分析与单元测试生成",
    title: "Codebuddy 伴侣运行时"
  },
  {
    id: "cursor-code",
    name: "Cursor",
    category: "acp",
    recommendedPath: "cursor-cli",
    recommendedArgs: "-v",
    recommendedEnvKey: "CURSOR_API_KEY",
    recommendedEnvVal: "",
    description: "Cursor 编辑器特置命令行，执行后台文件重构任务",
    title: "Cursor Shell 挂载运行时"
  },
  {
    id: "deepagents",
    name: "DeepAgents",
    category: "acp",
    recommendedPath: "deepagents",
    recommendedArgs: "-v",
    recommendedEnvKey: "DEEPAGENTS_API_KEY",
    recommendedEnvVal: "",
    description: "支持深度强化学习训练的下一代终端智能体群",
    title: "DeepAgents 多智能集群"
  }
];

function App() {
  const [activeTab, setActiveTab] = useState<"chat" | "memory" | "agentManager" | "agent" | "settings">("chat");
  const [dbStatus] = useState<"online" | "offline">("online");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [geminiMode, setGeminiMode] = useState<"auto edit" | "yolo" | "plan">("plan");
  const [isThinkingFlowOpen, setIsThinkingFlowOpen] = useState<boolean>(false);
  const thinkingPreRef = useRef<HTMLPreElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);


  // ==========================================
  // Tab 0: Workspace Chat UI States
  // ==========================================
  const [chatSessions, setChatSessions] = useState<any[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [chatMode, setChatMode] = useState<"local" | "github" | "free">("local");
  const [chatMessageInput, setChatMessageInput] = useState("");
  const [workspacePath, setWorkspacePath] = useState("/home/kylin/workspace/Aide");
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteQuery, setAutocompleteQuery] = useState("");
  const [autocompleteSelectedIndex, setAutocompleteSelectedIndex] = useState(0);
  const [selectedAgentForChat, setSelectedAgentForChat] = useState<string>("claude-code");
  const [chatStatus, setChatStatus] = useState<"idle" | "spawning" | "running">("idle");
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatThinkingStream, setChatThinkingStream] = useState<string>("");

  // ==========================================
  // ACP Agent Client Protocol States & Refs
  // ==========================================
  const [acpSessionId, setAcpSessionId] = useState<string | null>(null);
  const [isAcpInitialized, setIsAcpInitialized] = useState<boolean>(false);
  const [isAcpSessionCreated, setIsAcpSessionCreated] = useState<boolean>(false);

  const acpSessionIdRef = useRef<string | null>(null);
  const isAcpInitializedRef = useRef<boolean>(false);
  const isAcpSessionCreatedRef = useRef<boolean>(false);
  const acpBufferRef = useRef<string>("");
  const pendingPromptRef = useRef<string | null>(null);

  const selectedAgentForChatRef = useRef<string>("claude-code");
  const workspacePathRef = useRef<string>("/home/kylin/workspace/Aide");
  const isAgentRunningRef = useRef<boolean>(false);
  const registeredAgentsRef = useRef<any[]>([]);

  const updateAcpSessionId = (id: string | null) => {
    setAcpSessionId(id);
    acpSessionIdRef.current = id;
  };
  const updateIsAcpInitialized = (val: boolean) => {
    setIsAcpInitialized(val);
    isAcpInitializedRef.current = val;
  };
  const updateIsAcpSessionCreated = (val: boolean) => {
    setIsAcpSessionCreated(val);
    isAcpSessionCreatedRef.current = val;
  };

  // ==========================================
  // Tab 1: Memory CRDT States
  // ==========================================
  const [sessionId, setSessionId] = useState("session-001");
  const [sessionTitle, setSessionTitle] = useState("Aide 核心设计思考记录");
  const [markdownContent, setMarkdownContent] = useState(
    "# Aide 核心设计思考\n\n- 短期记忆: 采用内存 Loro CRDT 双向协同，支持多端增量合并。\n- 长期记忆: 本地 LanceDB 向量检索库。\n- 安全拦截: Stdio 拦截，Command Guard 物理托盘确认防死锁。"
  );
  const [memoryStatus, setMemoryStatus] = useState("");

  // ==========================================
  // Tab 2: Agent Terminal States
  // ==========================================
  const [selectedRegistryId, setSelectedRegistryId] = useState<string>("custom");
  const [agentId, setAgentId] = useState("claude-code");
  const [execPath, setExecPath] = useState("ping"); // Default simple command to test on Linux
  const [argsInput, setArgsInput] = useState("127.0.0.1 -c 4"); // 4 pings
  const [envKey, setEnvKey] = useState("ANTHROPIC_API_KEY");
  const [envVal, setEnvVal] = useState("sk-ant-mock-key-12345");
  const [stdinMessage, setStdinMessage] = useState("");
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([
    { text: "Aide Stdio Supervisor initialized. Ready to launch subagents.", type: "system", timestamp: getNowTime() }
  ]);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // ==========================================
  // Tab 3: System Settings States
  // ==========================================
  const [apiKey, setApiKey] = useState("");
  const [proxyUrl, setProxyUrl] = useState("http://127.0.0.1:7890");
  const [modelProvider, setModelProvider] = useState("DeepSeek");
  const [onnxStatus] = useState("paraphrase-multilingual-MiniLM-L12-v2 (Loaded)");
  const [allowExternal, setAllowExternal] = useState(false);
  const [accessPassword, setAccessPassword] = useState("");
  const [settingsStatus, setSettingsStatus] = useState("");

  // Web client states
  const [isWebMode, setIsWebMode] = useState(false);
  const [showWebAuthModal, setShowWebAuthModal] = useState(false);
  const [webHostInput, setWebHostInput] = useState("");
  const [webPasswordInput, setWebPasswordInput] = useState("");
  const [webAuthError, setWebAuthError] = useState("");

  // Web directory explorer states
  const [showDirExplorer, setShowDirExplorer] = useState(false);
  const [explorerCurrentPath, setExplorerCurrentPath] = useState("");
  const [explorerParentPath, setExplorerParentPath] = useState<string | null>(null);
  const [explorerSubdirs, setExplorerSubdirs] = useState<string[]>([]);
  const [explorerError, setExplorerError] = useState("");


  const verifyWebCredentials = async (host: string, pass: string) => {
    setWebAuthError("");
    try {
      // Test connect with get_config_val
      const res = await fetch(`http://${host}/api/invoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${pass}`
        },
        body: JSON.stringify({ cmd: "get_config_val", args: { key: "model_provider" } })
      });
      if (res.status === 401) {
        setWebAuthError("验证失败：访问密码错误。");
        setShowWebAuthModal(true);
      } else if (!res.ok) {
        setWebAuthError(`连接失败：HTTP ${res.status}`);
        setShowWebAuthModal(true);
      } else {
        // Validated! Save to localStorage and close modal
        localStorage.setItem("aide_host", host);
        localStorage.setItem("aide_password", pass);
        setShowWebAuthModal(false);
        
        // Trigger data load immediately upon validation
        const savedKey: any = await invoke("get_config_val", { key: "api_key" });
        if (savedKey) setApiKey(savedKey);
        const savedProxy: any = await invoke("get_config_val", { key: "proxy_url" });
        if (savedProxy) setProxyUrl(savedProxy);
        const savedProvider: any = await invoke("get_config_val", { key: "model_provider" });
        if (savedProvider) setModelProvider(savedProvider);
        const savedAllowExternal: any = await invoke("get_config_val", { key: "allow_external" });
        setAllowExternal(savedAllowExternal === "true");
        const savedAccessPassword: any = await invoke("get_config_val", { key: "access_password" });
        if (savedAccessPassword) setAccessPassword(savedAccessPassword);

        fetchRegisteredAgents();
        fetchChatSessions();
        scanWorkspaceFiles();
      }
    } catch (e: any) {
      setWebAuthError(`无法连接到后台服务 (${e.message || e})。请确保守护进程正在运行。`);
      setShowWebAuthModal(true);
    }
  };

  // ==========================================
  // Tab 4: Agent Manager States
  // ==========================================
  const [registeredAgents, setRegisteredAgents] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<AgentTemplate>(AGENT_TEMPLATES[0]);
  const [configName, setConfigName] = useState(AGENT_TEMPLATES[0].title);
  const [execPathInput, setExecPathInput] = useState(AGENT_TEMPLATES[0].recommendedPath);
  const [argsInputVal, setArgsInputVal] = useState(AGENT_TEMPLATES[0].recommendedArgs);
  const [envKeyInput, setEnvKeyInput] = useState(AGENT_TEMPLATES[0].recommendedEnvKey);
  const [envValInput, setEnvValInput] = useState(AGENT_TEMPLATES[0].recommendedEnvVal);
  
  const [testStatus, setTestStatus] = useState<"none" | "testing" | "ready" | "failed">("none");
  const [testOutput, setTestOutput] = useState("");
  const [agentCenterStatus, setAgentCenterStatus] = useState("");

  useEffect(() => {
    selectedAgentForChatRef.current = selectedAgentForChat;
  }, [selectedAgentForChat]);

  useEffect(() => {
    workspacePathRef.current = workspacePath;
  }, [workspacePath]);

  useEffect(() => {
    isAgentRunningRef.current = isAgentRunning;
  }, [isAgentRunning]);

  useEffect(() => {
    registeredAgentsRef.current = registeredAgents;
  }, [registeredAgents]);

  // ==========================================
  // Workspace Chat DB & Autocomplete Actions
  // ==========================================
  const fetchChatSessions = async () => {
    try {
      const sessions: any = await invoke("get_chat_sessions");
      setChatSessions(sessions || []);
    } catch (err) {
      console.error("Failed to fetch chat sessions:", err);
    }
  };

  const scanWorkspaceFiles = async () => {
    try {
      const files: any = await invoke("list_workspace_files", { workspacePath });
      setWorkspaceFiles(files || []);
    } catch (err) {
      console.error("Failed to scan workspace files:", err);
    }
  };

  const openDirExplorer = async (startPath?: string) => {
    setExplorerError("");
    try {
      const pathArg = startPath || workspacePath || "";
      const res = await invoke("browse_filesystem", { path: pathArg });
      setExplorerCurrentPath(res.current_path);
      setExplorerParentPath(res.parent_path);
      setExplorerSubdirs(res.subdirs || []);
      setShowDirExplorer(true);
    } catch (err: any) {
      setExplorerError(err.message || String(err));
      setShowDirExplorer(true);
    }
  };

  const navigateDir = async (targetPath: string) => {
    setExplorerError("");
    try {
      const res = await invoke("browse_filesystem", { path: targetPath });
      setExplorerCurrentPath(res.current_path);
      setExplorerParentPath(res.parent_path);
      setExplorerSubdirs(res.subdirs || []);
    } catch (err: any) {
      setExplorerError(err.message || String(err));
    }
  };

  const selectExplorerDir = (selectedPath: string) => {
    setWorkspacePath(selectedPath);
    setShowDirExplorer(false);

    try {
      if (isAgentRunning || chatStatus !== "idle") {
        invoke("kill_subagent", { agentId: selectedAgentForChat }).catch(() => {});
        invoke("kill_all_acp_terminals").catch(() => {});
      }
    } catch (err) {
      console.error("Failed to kill agents on workspace change:", err);
    }
    setActiveSessionId(null);
    setChatMessages([]);
    setChatThinkingStream("");
    setChatMessageInput("");
    setChatStatus("idle");
    setIsAgentRunning(false);
    updateAcpSessionId(null);

    setTimeout(() => {
      invoke("list_workspace_files", { workspacePath: selectedPath })
        .then((files: any) => setWorkspaceFiles(files || []))
        .catch(console.error);
    }, 100);
  };

  const handleChooseWorkspace = async () => {
    if (isWebMode) {
      openDirExplorer(workspacePath);
      return;
    }
    try {
      const selectedPath = await invoke<string | null>("select_workspace_dialog");
      if (selectedPath) {
        setWorkspacePath(selectedPath);
        
        // 🚨 Bug Fix: 选择新的工作目录时重置当前对话，避免历史对话携带至新工作区，右侧展示对话初始化状态
        try {
          if (isAgentRunning || chatStatus !== "idle") {
            invoke("kill_subagent", { agentId: selectedAgentForChat }).catch(() => {});
            invoke("kill_all_acp_terminals").catch(() => {});
          }
        } catch (err) {
          console.error("Failed to kill agents on workspace change:", err);
        }
        setActiveSessionId(null);
        setChatMessages([]);
        setChatThinkingStream("");
        setChatMessageInput("");
        setChatStatus("idle");
        setIsAgentRunning(false);
        updateAcpSessionId(null);

        // 自动扫描新选定目录中的文件
        setTimeout(() => {
          invoke("list_workspace_files", { workspacePath: selectedPath })
            .then((files: any) => setWorkspaceFiles(files || []))
            .catch(console.error);
        }, 100);
      }
    } catch (err) {
      console.error("Failed to select workspace directory:", err);
    }
  };

  const formatTimeAgo = (timeStr: string) => {
    if (!timeStr) return "1w";
    try {
      const parsedDate = new Date(timeStr.replace(/-/g, "/"));
      const now = new Date();
      const diffMs = now.getTime() - parsedDate.getTime();
      
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return "just now";
      if (diffMins < 60) return `${diffMins}m`;
      
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) {
        if (parsedDate.getDate() === now.getDate() && parsedDate.getMonth() === now.getMonth() && parsedDate.getFullYear() === now.getFullYear()) {
          const h = parsedDate.getHours().toString().padStart(2, "0");
          const m = parsedDate.getMinutes().toString().padStart(2, "0");
          return `${h}:${m}`;
        }
        return `${diffHours}h`;
      }
      
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays < 7) return `${diffDays}d`;
      
      const diffWeeks = Math.floor(diffDays / 7);
      if (diffWeeks < 4) return `${diffWeeks}w`;
      
      return `${parsedDate.getMonth() + 1}/${parsedDate.getDate()}`;
    } catch {
      return "1w";
    }
  };

  const getGroupedSessions = () => {
    const groups: Record<string, typeof chatSessions> = {};
    for (const session of chatSessions) {
      const path = session.workspace_path || "未知工作区";
      if (!groups[path]) {
        groups[path] = [];
      }
      groups[path].push(session);
    }
    const sortedPaths = Object.keys(groups).sort((a, b) => {
      const newestA = new Date(groups[a][0]?.updated_at || 0).getTime();
      const newestB = new Date(groups[b][0]?.updated_at || 0).getTime();
      return newestB - newestA;
    });
    return { groups, sortedPaths };
  };

  const handleCreateNewChat = () => {
    try {
      if (isAgentRunning || chatStatus !== "idle") {
        invoke("kill_subagent", { agentId: selectedAgentForChat }).catch(() => {});
        invoke("kill_all_acp_terminals").catch(() => {});
      }
    } catch (err) {
      console.error("Failed to kill agents on new chat:", err);
    }
    setActiveSessionId(null);
    setChatMessages([]);
    setChatThinkingStream("");
    setChatMessageInput("");
    setChatStatus("idle");
    setIsAgentRunning(false);
    updateAcpSessionId(null);
  };

  const handleCreateNewChatInWorkspace = (selectedPath: string) => {
    try {
      if (isAgentRunning || chatStatus !== "idle") {
        invoke("kill_subagent", { agentId: selectedAgentForChat }).catch(() => {});
        invoke("kill_all_acp_terminals").catch(() => {});
      }
    } catch (err) {
      console.error("Failed to kill agents on new chat in folder:", err);
    }
    setWorkspacePath(selectedPath);
    setTimeout(() => {
      invoke("list_workspace_files", { workspacePath: selectedPath })
        .then((files: any) => setWorkspaceFiles(files || []))
        .catch(console.error);
    }, 100);
    setActiveSessionId(null);
    setChatMessages([]);
    setChatThinkingStream("");
    setChatMessageInput("");
    setChatStatus("idle");
    setIsAgentRunning(false);
    updateAcpSessionId(null);
  };

  const handleSelectSession = (id: string) => {
    const session = chatSessions.find(s => s.id === id);
    if (session) {
      setActiveSessionId(id);
      setWorkspacePath(session.workspace_path);
      setSelectedAgentForChat(session.agent_id);
      try {
        const msgs = JSON.parse(session.messages);
        setChatMessages(msgs || []);
      } catch {
        setChatMessages([]);
      }
      setChatThinkingStream("");
    }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await invoke("delete_chat_session", { id });
      if (activeSessionId === id) {
        handleCreateNewChat();
      }
      fetchChatSessions();
    } catch (err) {
      console.error("Failed to delete session:", err);
    }
  };

  useEffect(() => {
    const lastWord = chatMessageInput.split(/\s+/).pop() || "";
    if (lastWord.startsWith("@")) {
      const query = lastWord.substring(1).toLowerCase();
      setAutocompleteQuery(query);
      setShowAutocomplete(true);
    } else {
      setShowAutocomplete(false);
    }
  }, [chatMessageInput]);

  const handleSelectAutocompleteFile = (file: string) => {
    const words = chatMessageInput.split(/\s+/);
    words.pop();
    const nextInput = [...words, `[@${file}](file://${workspacePath}/${file}) `].join(" ");
    setChatMessageInput(nextInput);
    setShowAutocomplete(false);
  };

  const handleChatInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showAutocomplete) {
      const files = workspaceFiles.filter(f => f.toLowerCase().includes(autocompleteQuery));
      const maxIdx = Math.min(files.length, 10);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAutocompleteSelectedIndex(prev => (prev + 1) % maxIdx);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setAutocompleteSelectedIndex(prev => (prev + maxIdx - 1) % maxIdx);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = files[autocompleteSelectedIndex];
        if (selected) {
          handleSelectAutocompleteFile(selected);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setShowAutocomplete(false);
      }
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendChatMessage();
    }
  };

  const handleSendChatMessage = async () => {
    if (!chatMessageInput.trim()) return;

    const userMessage = {
      role: "user",
      content: chatMessageInput,
      timestamp: getNowTime()
    };

    const updatedMessages = [...chatMessages, userMessage];
    setChatMessages(updatedMessages);
    setChatMessageInput("");
    setChatThinkingStream("");
    setIsThinkingFlowOpen(true);

    const activeId = activeSessionId || `session-${Date.now()}`;
    if (!activeSessionId) {
      setActiveSessionId(activeId);
    }

    const currentAgent = registeredAgents.find(a => a.agent_id === selectedAgentForChat) || {
      agent_id: "claude-code",
      name: "Claude Code",
      path: "claude",
      env_vars: "{}"
    };

    const isAcpMode = currentAgent.agent_id === "gemini" || currentAgent.agent_id === "google-gemini" || currentAgent.path.includes("gemini");

    const assistantMessage = {
      role: "assistant",
      content: "",
      timestamp: getNowTime()
    };

    // 1. 如果子智能体已经在常驻运行中
    if (isAgentRunning && agentId === selectedAgentForChat) {
      if (isAcpMode) {
        const sid = acpSessionIdRef.current;
        if (sid) {
          // 常驻会�����建立完毕，直接发送协议 prompt
          const promptCmd = {
            jsonrpc: "2.0",
            method: "session/prompt",
            params: {
              sessionId: sid,
              prompt: [
                {
                  type: "text",
                  text: userMessage.content
                }
              ]
            },
            id: Math.floor(Math.random() * 1000000)
          };
          try {
            await invoke("write_subagent_stdin", {
              agentId: selectedAgentForChat,
              message: JSON.stringify(promptCmd)
            });
            setChatMessages(prev => [...prev, assistantMessage]);
          } catch (err: any) {
            setChatThinkingStream(prev => prev + `❌ 发送协议对话失败: ${err}\n`);
            setChatStatus("idle");
            setIsThinkingFlowOpen(false);
          }
        } else {
          // ACP 会话初始化正在进行中，把对话挂起，等建立成功后自动补发
          pendingPromptRef.current = userMessage.content;
          setChatMessages(prev => [...prev, assistantMessage]);
          setChatThinkingStream(prev => prev + `⏳ 会话正在后台初始化中，已为您挂起当前消息，就绪后立刻自动补发...\n`);
        }
      } else {
        // 普通非 ACP 模式：直接向裸 Stdin 写入
        try {
          await invoke("write_subagent_stdin", {
            agentId: selectedAgentForChat,
            message: userMessage.content
          });
          setChatMessages(prev => [...prev, assistantMessage]);
        } catch (err: any) {
          setChatThinkingStream(prev => prev + `❌ 写入管道失败: ${err}\n`);
          setChatStatus("idle");
          setIsThinkingFlowOpen(false);
        }
      }
      return;
    }

    // 2. 子智能体未运行，执行首次拉起与握手初始化
    setChatStatus("spawning");
    setChatThinkingStream("正在唤醒智能体进程，建立管道 Stdio 链路中...\n");

    // 重置前端 ACP 会话状态
    updateAcpSessionId(null);
    updateIsAcpInitialized(false);
    updateIsAcpSessionCreated(false);
    acpBufferRef.current = "";

    if (isAcpMode) {
      pendingPromptRef.current = userMessage.content;
    }

    try {
      if (isAgentRunning) {
        try {
          await invoke("kill_subagent", { agentId: agentId });
        } catch {}
      }

      setAgentId(currentAgent.agent_id);
      setExecPath(currentAgent.path);

      const envs = currentAgent.env_vars ? JSON.parse(currentAgent.env_vars) : {};
      const envKeyName = Object.keys(envs)[0] || "";
      const envValName = envKeyName ? envs[envKeyName] : "";
      setEnvKey(envKeyName);
      setEnvVal(envValName);

      // 如果是 Gemini (ACP Mode)，我们根据选择的运行模式传递对应参数
      let currentArgs: string[] = [];
      if (isAcpMode) {
        currentArgs.push("--acp");
        currentArgs.push("--approval-mode");
        if (geminiMode === "auto edit") {
          currentArgs.push("auto_edit");
        } else if (geminiMode === "yolo") {
          currentArgs.push("yolo");
        } else if (geminiMode === "plan") {
          currentArgs.push("plan");
        }
      } else {
        currentArgs = ["127.0.0.1", "-c", "4"];
      }
      setArgsInput(currentArgs.join(" "));

      await invoke("run_subagent", {
        agentId: currentAgent.agent_id,
        execPath: currentAgent.path,
        args: currentArgs,
        envVars: envKeyName ? { [envKeyName]: envValName } : {},
        cwd: workspacePathRef.current,
      });

      setIsAgentRunning(true);
      setChatMessages(prev => [...prev, assistantMessage]);

      if (isAcpMode) {
        setChatThinkingStream(prev => prev + "🟢 智能体进程已唤醒！正在进行 ACP 协议双向握手...\n⚡ 发送 connection.initialize 握手报文...\n");
        // 发送 initialize
        const initCmd = {
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: 1,
            clientCapabilities: {
              terminal: true,
              fs: {
                readTextFile: true,
                writeTextFile: true
              }
            }
          },
          id: 1
        };
        await invoke("write_subagent_stdin", {
          agentId: currentAgent.agent_id,
          message: JSON.stringify(initCmd)
        });
      } else {
        // 普通非 ACP 智能体，直接切为 running 状态，并写入裸文本
        setChatStatus("running");
        setChatThinkingStream(prev => prev + "🟢 智能体进程已成功启动！\n");
        await invoke("write_subagent_stdin", {
          agentId: currentAgent.agent_id,
          message: userMessage.content
        });
      }
    } catch (err: any) {
      setChatStatus("idle");
      setIsThinkingFlowOpen(false);
      setChatThinkingStream(prev => prev + `❌ 启动失败: ${err}\n`);
      pendingPromptRef.current = null;
    }
  };

  const handleStopChatMessage = async () => {
    setChatThinkingStream((prev) => prev + `\n🛑 收到中断指令。正在级联强行中止智能体推理及所有活跃命令...\n`);
    setIsThinkingFlowOpen(false);
    try {
      await invoke("kill_subagent", { agentId: selectedAgentForChat });
      await invoke("kill_all_acp_terminals");
      setChatThinkingStream((prev) => prev + `🧹 成功强杀智能体主进程，并清理了所有关联的活跃命令子进程！\n`);
    } catch (err) {
      setChatThinkingStream((prev) => prev + `❌ 强行中止失败: ${err}\n`);
      setIsAgentRunning(false);
      setChatStatus("idle");
      updateAcpSessionId(null);
    }
  };

  // Auto debounce save chat session to SQLite
  useEffect(() => {
    if (activeSessionId && chatMessages.length > 0) {
      const timer = setTimeout(() => {
        const activeTitle = chatMessages[0]?.content?.substring(0, 18) || "项目对话分析";
        const sessionData = {
          id: activeSessionId,
          title: activeTitle,
          workspace_path: workspacePath,
          agent_id: selectedAgentForChat,
          messages: JSON.stringify(chatMessages)
        };
        invoke("save_chat_session", { session: sessionData })
          .then(() => fetchChatSessions())
          .catch(console.error);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [chatMessages, activeSessionId, workspacePath, selectedAgentForChat]);

  // ==========================================
  // Lifecycles & Listeners
  // ==========================================
  useEffect(() => {
    const inTauri = typeof window !== "undefined" && ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);
    setIsWebMode(!inTauri);

    if (inTauri) {
      loadSettings();
      fetchRegisteredAgents();
      fetchChatSessions();
      scanWorkspaceFiles();
    } else {
      // Browser mode: Check if we have credentials saved
      const savedHost = localStorage.getItem("aide_host") || window.location.host;
      const savedPassword = localStorage.getItem("aide_password");
      setWebHostInput(savedHost);
      
      if (!savedPassword) {
        setShowWebAuthModal(true);
        return; // Wait for authentication
      } else {
        if (showWebAuthModal) {
          return; // Wait for modal action
        }
        // Validated! Load data now
        loadSettings();
        fetchRegisteredAgents();
        fetchChatSessions();
        scanWorkspaceFiles();
      }
    }

    let unlistenOutput: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    let wsInstance: WebSocket | null = null;
    
    const handleAcpMessage = async (msg: any) => {
      // 调试用：在思考流中看到协议走向，极富科技感
      if (msg.method) {
        setChatThinkingStream((prev) => prev + `⚡ [ACP Method] ${msg.method}\n`);
      } else if (msg.id !== undefined) {
        setChatThinkingStream((prev) => prev + `⚡ [ACP Response] ID: ${msg.id}\n`);
      }

      // 1. Response 处理 (带有 id 且不带 method)
      if (msg.id !== undefined && !msg.method) {
        if (msg.id === 1) {
          // connection.initialize 的回复
          setChatThinkingStream((prev) => prev + `🟢 ACP 协议握手成功！正在初始化项目会话...\n`);
          updateIsAcpInitialized(true);

          // 自动发送 session/new
          const newSessionCmd = {
            jsonrpc: "2.0",
            method: "session/new",
            params: {
              cwd: workspacePathRef.current,
              mcpServers: []
            },
            id: 2
          };
          try {
            await invoke("write_subagent_stdin", {
              agentId: selectedAgentForChatRef.current,
              message: JSON.stringify(newSessionCmd)
            });
          } catch (err) {
            setChatThinkingStream((prev) => prev + `❌ 发送 session/new 失败: ${err}\n`);
          }
        } else if (msg.id === 2) {
          // 对 session/new 的回复
          const sessionResponseId = msg.result?.sessionId;
          if (sessionResponseId) {
            setChatThinkingStream((prev) => prev + `🟢 ACP 项目会话建立成功！\n🔑 会话ID: ${sessionResponseId}\n`);
            updateAcpSessionId(sessionResponseId);
            updateIsAcpSessionCreated(true);
            setChatStatus("running");

            // 探测是否有挂起的待处理 Prompt
            const pending = pendingPromptRef.current;
            if (pending) {
              setChatThinkingStream((prev) => prev + `⚡ 正在为您补发挂起的对话报文...\n`);
              const promptCmd = {
                jsonrpc: "2.0",
                method: "session/prompt",
                params: {
                  sessionId: sessionResponseId,
                  prompt: [
                    {
                      type: "text",
                      text: pending
                    }
                  ]
                },
                id: Math.floor(Math.random() * 1000000)
              };
              pendingPromptRef.current = null; // 清空
              try {
                await invoke("write_subagent_stdin", {
                  agentId: selectedAgentForChatRef.current,
                  message: JSON.stringify(promptCmd)
                });
              } catch (err) {
                setChatThinkingStream((prev) => prev + `❌ 补发对话报文失败: ${err}\n`);
              }
            }
          } else {
            setChatThinkingStream((prev) => prev + `❌ 会话建立回复异常，未获取到 sessionId\n`);
          }
        } else {
          // 对 session/prompt 的回复，代表当前指令及思考流已执行完毕，自动折叠思考流并设为 idle
          setChatStatus("idle");
          setIsThinkingFlowOpen(false);
          setChatThinkingStream((prev) => prev + `🟢 [ACP] 当前指令执行完毕。\n`);
        }
        return;
      }

      // 2. Notification 处理 (带有 method 且不带 id)
      if (msg.method === "session/update" && msg.params) {
        const update = msg.params.update;
        if (!update) return;

        if (update.sessionUpdate === "agent_thought_chunk") {
          const thought = update.content?.text || "";
          setChatThinkingStream((prev) => prev + thought);
        } else if (update.sessionUpdate === "agent_message_chunk") {
          const messageText = update.content?.text || "";
          setChatMessages((prev) => {
            if (prev.length === 0) return prev;
            const last = { ...prev[prev.length - 1] };
            if (last.role === "assistant") {
              last.content += messageText;
              return [...prev.slice(0, prev.length - 1), last];
            }
            return prev;
          });
        }
        return;
      }

      // 3. Request 处理 (来自智能体的工具调用或权限审批)
      if (msg.method && msg.id !== undefined) {
        if (msg.method === "session/request_permission") {
          const toolTitle = msg.params?.toolCall?.title || "未知工具";
          // 遵循 Lody 的 selectAutoApprovePermissionDecision 逻辑:
          // 优先选择 allow_always -> allow_once -> 任何 allow* 开头的 option
          const options = msg.params?.options || [];
          let selectedOption = options.find((o: any) => o.kind === "allow_always")
            || options.find((o: any) => o.kind === "allow_once")
            || options.find((o: any) => typeof o.kind === "string" && o.kind.startsWith("allow"))
            || options[0]; // 兜底取第一个
          
          const optionId = selectedOption?.optionId || "allow";
          setChatThinkingStream((prev) => prev + `🛡️ [Command Guard] 智能体申请执行 [${toolTitle}] 权限，已自动批准 (optionId: ${optionId})\n`);
          
          // ★ 关键修复：必须是嵌套结构 { outcome: { outcome: "selected", optionId } }
          // 这与 Lody L135621-135623 的格式完全对齐：return { outcome: autoApproveOutcome }
          // 其中 autoApproveOutcome = { outcome: "selected", optionId: "..." }
          const approveResponse = {
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              outcome: {
                outcome: "selected",
                optionId: optionId
              }
            }
          };
          try {
            await invoke("write_subagent_stdin", {
              agentId: selectedAgentForChatRef.current,
              message: JSON.stringify(approveResponse)
            });
          } catch (err) {
            setChatThinkingStream((prev) => prev + `❌ 发送权限批准失败: ${err}\n`);
          }
        } else if (msg.method === "fs/read_text_file") {
          const filePath = msg.params?.path || "";
          setChatThinkingStream((prev) => prev + `📂 [ACP FS] 智能体请求读取文件: ${filePath}...\n`);
          
          let fileContent = "";
          try {
            fileContent = await invoke<string>("read_acp_file", {
              workspacePath: workspacePathRef.current,
              filePath: filePath
            });
            setChatThinkingStream((prev) => prev + `🟢 [ACP FS] 成功读取文件: ${filePath}\n`);
          } catch (err) {
            setChatThinkingStream((prev) => prev + `⚠️ [ACP FS] 读取文件失败 (可能文件尚不存在): ${filePath} (${err})\n`);
          }

          const readResponse = {
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              content: fileContent
            }
          };
          try {
            await invoke("write_subagent_stdin", {
              agentId: selectedAgentForChatRef.current,
              message: JSON.stringify(readResponse)
            });
          } catch (err) {
            console.error("Failed to write to subagent stdin for readResponse:", err);
          }
        } else if (msg.method === "fs/write_text_file") {
          const filePath = msg.params?.path || "";
          const content = msg.params?.content || "";
          setChatThinkingStream((prev) => prev + `💾 [ACP FS] 智能体请求写入文件: ${filePath}...\n`);
          
          try {
            await invoke("write_acp_file", {
              workspacePath: workspacePathRef.current,
              filePath: filePath,
              content: content
            });
            setChatThinkingStream((prev) => prev + `🟢 [ACP FS] 成功写入物理文件: ${filePath}\n`);
          } catch (err) {
            setChatThinkingStream((prev) => prev + `❌ [ACP FS] 写入物理文件失败: ${filePath} (${err})\n`);
          }

          const writeResponse = {
            jsonrpc: "2.0",
            id: msg.id,
            result: {}
          };
          try {
            await invoke("write_subagent_stdin", {
              agentId: selectedAgentForChatRef.current,
              message: JSON.stringify(writeResponse)
            });
          } catch (err) {
            console.error("Failed to write to subagent stdin for writeResponse:", err);
          }
        } else if (msg.method === "terminal/create") {
          // ★ 新增：终端创建 - Gemini 通过此方法执行 shell 命令
          const command = msg.params?.command || "";
          const args = msg.params?.args || [];
          const cwd = msg.params?.cwd || workspacePathRef.current;
          const envArr = msg.params?.env || [];
          const terminalId = `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          
          setChatThinkingStream((prev) => prev + `🖥️ [ACP Terminal] 创建终端: ${command} ${args.join(" ")} (id: ${terminalId})\n`);

          // 将 env 数组转为 map
          const envMap: Record<string, string> = {};
          for (const e of envArr) {
            if (e.name && e.value) {
              envMap[e.name] = e.value;
            }
          }

          // 异步执行命令，结果存到 ref map 里
          const terminalPromise = invoke<any>("run_acp_terminal", {
            terminalId,
            command,
            args,
            cwd,
            envVars: envMap
          }).then((result: any) => {
            return {
              output: (result.stdout || "") + (result.stderr || ""),
              truncated: false,
              exitStatus: {
                exitCode: result.exit_code ?? null,
                signal: result.signal ?? null
              }
            };
          }).catch((err: any) => {
            return {
              output: `Error: ${err}`,
              truncated: false,
              exitStatus: {
                exitCode: 1,
                signal: null
              }
            };
          });

          // 存储到 terminal map
          if (!(window as any).__acpTerminals) {
            (window as any).__acpTerminals = {};
          }
          (window as any).__acpTerminals[terminalId] = terminalPromise;

          // 立即回复 terminalId
          const createResponse = {
            jsonrpc: "2.0",
            id: msg.id,
            result: { terminalId }
          };
          try {
            await invoke("write_subagent_stdin", {
              agentId: selectedAgentForChatRef.current,
              message: JSON.stringify(createResponse)
            });
          } catch (err) {
            setChatThinkingStream((prev) => prev + `❌ [ACP Terminal] 回复终端创建失败: ${err}\n`);
          }
        } else if (msg.method === "terminal/output") {
          // ★ 新增：获取终端输出
          const terminalId = msg.params?.terminalId || "";
          setChatThinkingStream((prev) => prev + `📤 [ACP Terminal] 获取终端输出: ${terminalId}\n`);

          let termResult: any = { output: "", truncated: false };
          try {
            const terminals = (window as any).__acpTerminals || {};
            if (terminals[terminalId]) {
              termResult = await terminals[terminalId];
            }
          } catch {}

          const outputResponse = {
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              output: termResult.output || "",
              truncated: termResult.truncated || false,
              exitStatus: termResult.exitStatus || undefined
            }
          };
          try {
            await invoke("write_subagent_stdin", {
              agentId: selectedAgentForChatRef.current,
              message: JSON.stringify(outputResponse)
            });
          } catch (err) {
            console.error("Failed to send terminal output response:", err);
          }
        } else if (msg.method === "terminal/wait_for_exit") {
          // ★ 新增：等待终端退出
          const terminalId = msg.params?.terminalId || "";
          setChatThinkingStream((prev) => prev + `⏳ [ACP Terminal] 等待终端退出: ${terminalId}\n`);

          let exitStatus: any = { exitCode: 0, signal: null };
          try {
            const terminals = (window as any).__acpTerminals || {};
            if (terminals[terminalId]) {
              const termResult = await terminals[terminalId];
              exitStatus = termResult.exitStatus || { exitCode: 0, signal: null };
              setChatThinkingStream((prev) => prev + `🟢 [ACP Terminal] 终端已退出 (code: ${exitStatus.exitCode})\n`);
            }
          } catch {}

          const waitResponse = {
            jsonrpc: "2.0",
            id: msg.id,
            result: exitStatus
          };
          try {
            await invoke("write_subagent_stdin", {
              agentId: selectedAgentForChatRef.current,
              message: JSON.stringify(waitResponse)
            });
          } catch (err) {
            console.error("Failed to send terminal wait_for_exit response:", err);
          }
        } else if (msg.method === "terminal/release") {
          // ★ 新增：释放终端资源
          const terminalId = msg.params?.terminalId || "";
          setChatThinkingStream((prev) => prev + `🗑️ [ACP Terminal] 释放终端: ${terminalId}\n`);
          
          // 清理 terminal map
          if ((window as any).__acpTerminals) {
            delete (window as any).__acpTerminals[terminalId];
          }

          const releaseResponse = {
            jsonrpc: "2.0",
            id: msg.id,
            result: {}
          };
          try {
            await invoke("write_subagent_stdin", {
              agentId: selectedAgentForChatRef.current,
              message: JSON.stringify(releaseResponse)
            });
          } catch (err) {
            console.error("Failed to send terminal release response:", err);
          }
        } else if (msg.method === "terminal/kill") {
          // ★ 新增：终止终端进程
          const terminalId = msg.params?.terminalId || "";
          setChatThinkingStream((prev) => prev + `💀 [ACP Terminal] 强制终止终端: ${terminalId}\n`);
          try {
            await invoke("kill_acp_terminal", { terminalId });
          } catch (err) {
            console.error("Failed to invoke kill_acp_terminal:", err);
          }

          const killResponse = {
            jsonrpc: "2.0",
            id: msg.id,
            result: {}
          };
          try {
            await invoke("write_subagent_stdin", {
              agentId: selectedAgentForChatRef.current,
              message: JSON.stringify(killResponse)
            });
          } catch (err) {
            console.error("Failed to send terminal kill response:", err);
          }
        } else if (msg.method === "elicitation/create") {
          // ★ 新增：Elicitation 请求 - 返回取消（暂不支持交互式表单）
          setChatThinkingStream((prev) => prev + `📋 [ACP Elicitation] 收到交互式表单请求，暂不支持，已自动取消\n`);
          const elicitResponse = {
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              action: "cancelled"
            }
          };
          try {
            await invoke("write_subagent_stdin", {
              agentId: selectedAgentForChatRef.current,
              message: JSON.stringify(elicitResponse)
            });
          } catch (err) {
            console.error("Failed to send elicitation response:", err);
          }
        } else {
          // ★ 新增：Catch-all - 对未知方法返回 method_not_found 错误，防止代理端无限等待
          setChatThinkingStream((prev) => prev + `⚠️ [ACP] 未知方法: ${msg.method}，已返回 method_not_found\n`);
          const errorResponse = {
            jsonrpc: "2.0",
            id: msg.id,
            error: {
              code: -32601,
              message: `Method not found: ${msg.method}`
            }
          };
          try {
            await invoke("write_subagent_stdin", {
              agentId: selectedAgentForChatRef.current,
              message: JSON.stringify(errorResponse)
            });
          } catch (err) {
            console.error("Failed to send error response:", err);
          }
        }
        return;
      }
    };

    const setupListener = async () => {
      unlistenOutput = await listen<ProcessOutputPayload>("subagent-output", (event) => {
        const payload = event.payload;
        setTerminalLines((prev) => [
          ...prev,
          {
            text: payload.content,
            type: payload.stream_type === "stderr" ? "stderr" : "stdout",
            timestamp: getNowTime(),
          }
        ]);

        const currentAgent = registeredAgentsRef.current.find(a => a.agent_id === selectedAgentForChatRef.current);
        const isAcpMode = currentAgent?.agent_id === "gemini" || currentAgent?.agent_id === "google-gemini" || currentAgent?.path?.includes("gemini");

        if (!isAcpMode) {
          // 🟢 普通模式：原封不动走老逻辑，保持完美兼容
          setChatThinkingStream((prev) => prev + payload.content);
          setChatMessages((prev) => {
            if (prev.length === 0) return prev;
            const last = { ...prev[prev.length - 1] };
            if (last.role === "assistant") {
              const cleanContent = payload.content.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, ""); // Strip ANSI
              last.content += cleanContent;
              return [...prev.slice(0, prev.length - 1), last];
            }
            return prev;
          });
          return;
        }

        // 🟢 ACP 模式：走非阻塞字节流切片 NDJSON 路由
        if (payload.stream_type === "stderr") {
          setChatThinkingStream((prev) => prev + payload.content);
          return;
        }

        const nextBuffer = acpBufferRef.current + payload.content;
        acpBufferRef.current = nextBuffer;

        const lines = nextBuffer.split("\n");
        const incompleteLine = lines.pop() || "";
        acpBufferRef.current = incompleteLine;

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            handleAcpMessage(msg);
          } catch (err) {
            // 解析报错通常是混入了非 JSON 裸调试流，直接放入思考调试区
            setChatThinkingStream((prev) => prev + trimmed + "\n");
          }
        }
      });

      unlistenExit = await listen<{ agent_id: string; exit_code: number }>("subagent-exit", (event) => {
        const payload = event.payload;
        setTerminalLines((prev) => [
          ...prev,
          {
            text: `Process [${payload.agent_id}] exited with code ${payload.exit_code}`,
            type: "system",
            timestamp: getNowTime(),
          }
        ]);

        if (payload.agent_id === selectedAgentForChatRef.current) {
          setIsAgentRunning(false);
          setChatStatus("idle");
          setIsThinkingFlowOpen(false); // Collapsed on process exit
          updateAcpSessionId(null);
          setChatThinkingStream((prev) => prev + `\n🔴 智能体进程已自然退出 (exit_code: ${payload.exit_code})。会话结束。\n`);
        }
      });
    };

    if (inTauri) {
      setupListener().catch(console.error);
    } else {
      // Standard browser mode: WebSocket client connection
      const host = localStorage.getItem("aide_host") || window.location.host;
      const password = localStorage.getItem("aide_password") || "";
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      
      const wsUrl = `${wsProtocol}//${host}/ws?password=${password}`;
      console.log("Connecting to WebSocket:", wsUrl);
      const ws = new WebSocket(wsUrl);
      wsInstance = ws;
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.event === "subagent-output") {
            const payload = data.payload;
            setTerminalLines((prev) => [
              ...prev,
              {
                text: payload.content,
                type: payload.stream_type === "stderr" ? "stderr" : "stdout",
                timestamp: getNowTime(),
              }
            ]);

            const currentAgent = registeredAgentsRef.current.find(a => a.agent_id === selectedAgentForChatRef.current);
            const isAcpMode = currentAgent?.agent_id === "gemini" || currentAgent?.agent_id === "google-gemini" || currentAgent?.path?.includes("gemini");

            if (!isAcpMode) {
              setChatThinkingStream((prev) => prev + payload.content);
              setChatMessages((prev) => {
                if (prev.length === 0) return prev;
                const last = { ...prev[prev.length - 1] };
                if (last.role === "assistant") {
                  const cleanContent = payload.content.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
                  last.content += cleanContent;
                  return [...prev.slice(0, prev.length - 1), last];
                }
                return prev;
              });
              return;
            }

            const nextBuffer = acpBufferRef.current + payload.content;
            acpBufferRef.current = nextBuffer;

            const lines = nextBuffer.split("\n");
            const incompleteLine = lines.pop() || "";
            acpBufferRef.current = incompleteLine;

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const msg = JSON.parse(trimmed);
                handleAcpMessage(msg);
              } catch (err) {
                setChatThinkingStream((prev) => prev + trimmed + "\n");
              }
            }
          } else if (data.event === "subagent-exit") {
            const payload = data.payload;
            setTerminalLines((prev) => [
              ...prev,
              {
                text: `Process [${payload.agent_id}] exited with code ${payload.exit_code}`,
                type: "system",
                timestamp: getNowTime(),
              }
            ]);

            if (payload.agent_id === selectedAgentForChatRef.current) {
              setIsAgentRunning(false);
              setChatStatus("idle");
              setIsThinkingFlowOpen(false);
              updateAcpSessionId(null);
              setChatThinkingStream((prev) => prev + `\n🔴 智能体进程已自然退出 (exit_code: ${payload.exit_code})。会话结束。\n`);
            }
          }
        } catch (e) {
          console.error("Error parsing WebSocket message:", e);
        }
      };

      ws.onclose = () => {
        console.log("WebSocket closed.");
      };
    }

    return () => {
      if (unlistenOutput) unlistenOutput();
      if (unlistenExit) unlistenExit();
      if (wsInstance) wsInstance.close();
    };
  }, [showWebAuthModal]);

  useEffect(() => {
    if (activeTab === "chat" && workspacePath) {
      scanWorkspaceFiles();
    }
  }, [activeTab, workspacePath]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [terminalLines]);

  // Auto-scroll thinking stream
  useEffect(() => {
    if (thinkingPreRef.current) {
      thinkingPreRef.current.scrollTop = thinkingPreRef.current.scrollHeight;
    }
  }, [chatThinkingStream]);

  // Auto-scroll chat container to the bottom when messages, thinking stream updates, or thinking block toggles
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages, chatThinkingStream, isThinkingFlowOpen]);


  function getNowTime() {
    const d = new Date();
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  }

  // ==========================================
  // Actions: Tab 4 - Agent Manager Functions
  // ==========================================
  const fetchRegisteredAgents = async () => {
    try {
      const agents: any = await invoke("get_registered_agents");
      setRegisteredAgents(agents || []);
    } catch (e) {
      console.error("Failed to fetch registered agents:", e);
    }
  };

  const handleSelectTemplate = (tpl: AgentTemplate) => {
    setSelectedTemplate(tpl);
    setConfigName(tpl.title);
    setExecPathInput(tpl.recommendedPath);
    setArgsInputVal(tpl.recommendedArgs);
    setEnvKeyInput(tpl.recommendedEnvKey);
    setEnvValInput(tpl.recommendedEnvVal);
    setTestStatus("none");
    setTestOutput("");
  };

  const handleTestAgent = async () => {
    setTestStatus("testing");
    setTestOutput("启动可用性检测中，请稍候...");
    try {
      const args = argsInputVal.split(/\s+/).filter(Boolean);
      const envVars: Record<string, string> = {};
      if (envKeyInput) {
        envVars[envKeyInput] = envValInput;
      }
      
      const result: string = await invoke("test_agent_availability", {
        execPath: execPathInput,
        args: args.length > 0 ? args : ["--version"], // Standard version probe
        envVars,
      });
      setTestStatus("ready");
      setTestOutput(result);
    } catch (e: any) {
      setTestStatus("failed");
      let errorMsg = e.toString();
      if (navigator.userAgent.indexOf("Windows") !== -1) {
        errorMsg += "\n\n💡 [Windows 环境提示]:";
        errorMsg += "\n1. 若您刚安装 CLI，请确保 npm/python 全局目录已加入系统 PATH，并重启此应用。";
        errorMsg += "\n2. 请尝试输入完整的绝对路径，并务必加上后缀，例如: C:\\Users\\Name\\AppData\\Roaming\\npm\\gemini.cmd";
      }
      setTestOutput(errorMsg);
    }
  };

  const handleSaveAgent = async () => {
    try {
      setAgentCenterStatus("正在写入本地 SQLite 注册表...");
      const envVarsMap: Record<string, string> = {};
      if (envKeyInput) {
        envVarsMap[envKeyInput] = envValInput;
      }
      const envVarsJson = JSON.stringify(envVarsMap);

      let finalAgentId = selectedTemplate.id;
      if (finalAgentId === "custom-agent") {
        // Generate a unique ID based on timestamp to support multiple custom agents
        finalAgentId = `custom-agent-${Date.now()}`;
      }

      const agentData = {
        agent_id: finalAgentId,
        name: configName,
        path: execPathInput,
        version: testStatus === "ready" ? testOutput.substring(0, 50) : "1.0.0",
        env_vars: envVarsJson,
      };

      await invoke("save_agent_to_registry", { agent: agentData });
      setAgentCenterStatus("✅ 智能体可用性检测通过，成功注册并加入列表！");
      await fetchRegisteredAgents();
      setTimeout(() => setAgentCenterStatus(""), 3000);
    } catch (e: any) {
      setAgentCenterStatus(`❌ 注册失败: ${e}`);
    }
  };

  const handleDeleteAgent = async (agentIdToDelete: string) => {
    try {
      await invoke("delete_agent_from_registry", { agentId: agentIdToDelete });
      setAgentCenterStatus("🗑️ 智能体已成功从注册表注销。");
      await fetchRegisteredAgents();
      setTimeout(() => setAgentCenterStatus(""), 3000);
    } catch (e: any) {
      setAgentCenterStatus(`❌ 注销失败: ${e}`);
    }
  };

  // ==========================================
  // Actions: Tab 1 - Memory Functions
  // ==========================================
  const handleSaveMemory = async () => {
    try {
      setMemoryStatus("正在序列化 CRDT 快照...");
      // TextEncoder safely converts Chinese string to standard UTF-8 binary bytes
      const encoder = new TextEncoder();
      const snapshotBytes = encoder.encode(markdownContent);
      
      // Convert to Array for serialization over IPC boundary
      const snapshotArray = Array.from(snapshotBytes);

      await invoke("save_session_data", {
        sessionId,
        title: sessionTitle,
        snapshot: snapshotArray,
      });

      setMemoryStatus("✅ CRDT 快照成功写入 SQLite！");
      setTimeout(() => setMemoryStatus(""), 3000);
    } catch (e: any) {
      setMemoryStatus(`❌ 写入错误: ${e}`);
    }
  };

  const handleLoadMemory = async () => {
    try {
      setMemoryStatus("正在从数据库拉取二进制数据...");
      const snapshotArray: any = await invoke("load_session_data", {
        sessionId,
      });

      if (snapshotArray && snapshotArray.length > 0) {
        const decoder = new TextDecoder();
        const bytes = new Uint8Array(snapshotArray);
        const decodedText = decoder.decode(bytes);
        setMarkdownContent(decodedText);
        setMemoryStatus("✅ Loro 字节流就地反序列化还原完成！");
      } else {
        setMemoryStatus("⚠️ 未发现历史记录，已初始化空白 Loro 文档。");
      }
      setTimeout(() => setMemoryStatus(""), 3000);
    } catch (e: any) {
      setMemoryStatus(`❌ 加载错误: ${e}`);
    }
  };

  // ==========================================
  // Actions: Tab 2 - Subagent Process controls
  // ==========================================
  const handleSelectRegistryAgent = (id: string) => {
    setSelectedRegistryId(id);
    if (id === "custom") {
      return;
    }
    const agent = registeredAgents.find(a => a.agent_id === id);
    if (agent) {
      setAgentId(agent.agent_id);
      setExecPath(agent.path);
      setArgsInput("--acp"); // Pre-fill with standard ACP console flag
      
      try {
        if (agent.env_vars) {
          const envs = JSON.parse(agent.env_vars);
          const firstKey = Object.keys(envs)[0];
          if (firstKey) {
            setEnvKey(firstKey);
            setEnvVal(envs[firstKey]);
          } else {
            setEnvKey("");
            setEnvVal("");
          }
        } else {
          setEnvKey("");
          setEnvVal("");
        }
      } catch (e) {
        setEnvKey("");
        setEnvVal("");
      }
    }
  };

  const handleStartAgent = async () => {
    try {
      setTerminalLines((prev) => [
        ...prev,
        { text: `Launching subagent [${agentId}] via path [${execPath}]...`, type: "system", timestamp: getNowTime() }
      ]);

      const args = argsInput.split(/\s+/).filter(Boolean);
      const envVars: Record<string, string> = {};
      if (envKey) {
        envVars[envKey] = envVal;
      }

      await invoke("run_subagent", {
        agentId,
        execPath,
        args,
        envVars,
      });

      setIsAgentRunning(true);
      setTerminalLines((prev) => [
        ...prev,
        { text: `Process spawned successfully. Listening on stdout/stderr.`, type: "system", timestamp: getNowTime() }
      ]);
    } catch (e: any) {
      setTerminalLines((prev) => [
        ...prev,
        { text: `Spawn failed: ${e}`, type: "stderr", timestamp: getNowTime() }
      ]);
    }
  };

  const handleWriteStdin = async () => {
    if (!stdinMessage.trim()) return;
    try {
      await invoke("write_subagent_stdin", {
        agentId,
        message: stdinMessage,
      });
      setTerminalLines((prev) => [
        ...prev,
        { text: `[stdin] -> ${stdinMessage}`, type: "system", timestamp: getNowTime() }
      ]);
      setStdinMessage("");
    } catch (e: any) {
      setTerminalLines((prev) => [
        ...prev,
        { text: `Stdin writing failed: ${e}`, type: "stderr", timestamp: getNowTime() }
      ]);
    }
  };

  const handleKillAgent = async () => {
    try {
      await invoke("kill_subagent", { agentId });
      setIsAgentRunning(false);
      setTerminalLines((prev) => [
        ...prev,
        { text: `Subagent terminated cleanly.`, type: "system", timestamp: getNowTime() }
      ]);
    } catch (e: any) {
      setTerminalLines((prev) => [
        ...prev,
        { text: `Failed to terminate: ${e}`, type: "stderr", timestamp: getNowTime() }
      ]);
    }
  };

  // ==========================================
  // Actions: Tab 3 - System Settings

  // ==========================================
  const loadSettings = async () => {
    try {
      const savedKey: any = await invoke("get_config_val", { key: "api_key" });
      if (savedKey) setApiKey(savedKey);

      const savedProxy: any = await invoke("get_config_val", { key: "proxy_url" });
      if (savedProxy) setProxyUrl(savedProxy);

      const savedProvider: any = await invoke("get_config_val", { key: "model_provider" });
      if (savedProvider) setModelProvider(savedProvider);

      const savedAllowExternal: any = await invoke("get_config_val", { key: "allow_external" });
      setAllowExternal(savedAllowExternal === "true");

      const savedAccessPassword: any = await invoke("get_config_val", { key: "access_password" });
      if (savedAccessPassword) setAccessPassword(savedAccessPassword);
    } catch (e) {
      console.error("Failed to load configs:", e);
    }
  };

  const handleSaveSettings = async () => {
    try {
      setSettingsStatus("保存设置中...");
      await invoke("set_config_val", { key: "api_key", value: apiKey });
      await invoke("set_config_val", { key: "proxy_url", value: proxyUrl });
      await invoke("set_config_val", { key: "model_provider", value: modelProvider });
      await invoke("set_config_val", { key: "allow_external", value: allowExternal ? "true" : "false" });
      await invoke("set_config_val", { key: "access_password", value: accessPassword });
      
      setSettingsStatus("✅ 配置数据已物理写入 SQLite 数据库中！");
      setTimeout(() => setSettingsStatus(""), 3000);
    } catch (e: any) {
      setSettingsStatus(`❌ 保存失败: ${e}`);
    }
  };

  // ==========================================
  // Render App UI
  // ==========================================
  return (
    <div className="app-container">
      {/* 1. Sidebar Navigation */}
      <aside className={`sidebar ${isSidebarCollapsed ? "collapsed" : ""}`}>
        <div>
          <div className="brand-section" style={{ justifyContent: isSidebarCollapsed ? "center" : "flex-start", padding: isSidebarCollapsed ? "0" : "0 8px", marginBottom: "32px" }}>
            <div className="brand-logo">A</div>
            {!isSidebarCollapsed && <div className="brand-name">Aide Project</div>}
          </div>
          
          <nav className="nav-list">
            <div
              className={`nav-item ${activeTab === "chat" ? "active" : ""}`}
              onClick={() => setActiveTab("chat")}
              style={{ justifyContent: isSidebarCollapsed ? "center" : "flex-start", gap: isSidebarCollapsed ? "0" : "12px" }}
              title={isSidebarCollapsed ? "智能对话 (Chat)" : ""}
            >
              <span style={{ minWidth: "24px", display: "inline-flex", justifyContent: "center", alignItems: "center", color: activeTab === "chat" ? "var(--cyber-secondary)" : "inherit" }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "all 0.2s", filter: activeTab === "chat" ? "drop-shadow(0 0 4px var(--cyber-secondary))" : "none" }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </span>
              {!isSidebarCollapsed && <span>智能对话 (Chat)</span>}
            </div>
            <div
              className={`nav-item ${activeTab === "memory" ? "active" : ""}`}
              onClick={() => setActiveTab("memory")}
              style={{ justifyContent: isSidebarCollapsed ? "center" : "flex-start", gap: isSidebarCollapsed ? "0" : "12px" }}
              title={isSidebarCollapsed ? "记忆系统 (Memory)" : ""}
            >
              <span style={{ minWidth: "24px", display: "inline-flex", justifyContent: "center", alignItems: "center", color: activeTab === "memory" ? "var(--cyber-secondary)" : "inherit" }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "all 0.2s", filter: activeTab === "memory" ? "drop-shadow(0 0 4px var(--cyber-secondary))" : "none" }}><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-3.12 3 3 0 0 1 0-4.88 2.5 2.5 0 0 1 0-3.12A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-3.12 3 3 0 0 0 0-4.88 2.5 2.5 0 0 0 0-3.12A2.5 2.5 0 0 0 14.5 2Z"/></svg>
              </span>
              {!isSidebarCollapsed && <span>记忆系统 (Memory)</span>}
            </div>
            <div
              className={`nav-item ${activeTab === "agentManager" ? "active" : ""}`}
              onClick={() => setActiveTab("agentManager")}
              style={{ justifyContent: isSidebarCollapsed ? "center" : "flex-start", gap: isSidebarCollapsed ? "0" : "12px" }}
              title={isSidebarCollapsed ? "智能体中心 (Manager)" : ""}
            >
              <span style={{ minWidth: "24px", display: "inline-flex", justifyContent: "center", alignItems: "center", color: activeTab === "agentManager" ? "var(--cyber-secondary)" : "inherit" }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "all 0.2s", filter: activeTab === "agentManager" ? "drop-shadow(0 0 4px var(--cyber-secondary))" : "none" }}><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>
              </span>
              {!isSidebarCollapsed && <span>智能体中心 (Manager)</span>}
            </div>
            <div
              className={`nav-item ${activeTab === "agent" ? "active" : ""}`}
              onClick={() => setActiveTab("agent")}
              style={{ justifyContent: isSidebarCollapsed ? "center" : "flex-start", gap: isSidebarCollapsed ? "0" : "12px" }}
              title={isSidebarCollapsed ? "子进程 (Dispatcher)" : ""}
            >
              <span style={{ minWidth: "24px", display: "inline-flex", justifyContent: "center", alignItems: "center", color: activeTab === "agent" ? "var(--cyber-secondary)" : "inherit" }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "all 0.2s", filter: activeTab === "agent" ? "drop-shadow(0 0 4px var(--cyber-secondary))" : "none" }}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              </span>
              {!isSidebarCollapsed && <span>子进程 (Dispatcher)</span>}
            </div>
            <div
              className={`nav-item ${activeTab === "settings" ? "active" : ""}`}
              onClick={() => setActiveTab("settings")}
              style={{ justifyContent: isSidebarCollapsed ? "center" : "flex-start", gap: isSidebarCollapsed ? "0" : "12px" }}
              title={isSidebarCollapsed ? "全局配置 (Settings)" : ""}
            >
              <span style={{ minWidth: "24px", display: "inline-flex", justifyContent: "center", alignItems: "center", color: activeTab === "settings" ? "var(--cyber-secondary)" : "inherit" }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "all 0.2s", filter: activeTab === "settings" ? "drop-shadow(0 0 4px var(--cyber-secondary))" : "none" }}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </span>
              {!isSidebarCollapsed && <span>全局配置 (Settings)</span>}
            </div>
          </nav>
        </div>

        {/* Collapse Toggle Button - Sleek & Compact at the Bottom */}
        <div 
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          style={{
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: isSidebarCollapsed ? "center" : "flex-start",
            padding: isSidebarCollapsed ? "8px 0" : "8px 12px",
            color: "rgba(255, 255, 255, 0.35)",
            fontSize: "0.85rem",
            transition: "all 0.2s",
            margin: "auto 8px 12px 8px",
            borderRadius: "6px",
            background: "rgba(255, 255, 255, 0.02)",
            border: "1px solid rgba(255, 255, 255, 0.05)"
          }}
          className="collapse-toggle-btn nav-item"
          title={isSidebarCollapsed ? "展开导航" : "收起导航"}
        >
          <span style={{ fontSize: "1rem", minWidth: "20px", display: "inline-flex", justifyContent: "center" }}>
            {isSidebarCollapsed ? "▶" : "◀"}
          </span>
          {!isSidebarCollapsed && <span style={{ marginLeft: "8px", fontWeight: 500 }}>收起面板</span>}
        </div>

        <div className="sidebar-footer" style={{ alignItems: isSidebarCollapsed ? "center" : "stretch" }}>
          <div className="status-indicator" style={{ justifyContent: isSidebarCollapsed ? "center" : "flex-start" }}>
            <div className="dot" title={isSidebarCollapsed ? "Axum Daemon : 17790" : ""}></div>
            {!isSidebarCollapsed && <span> Axum Daemon : 17790</span>}
          </div>
          <div className="status-indicator" style={{ marginTop: "4px", justifyContent: isSidebarCollapsed ? "center" : "flex-start" }}>
            <div className={`dot ${dbStatus === "online" ? "" : "busy"}`} title={isSidebarCollapsed ? `SQLite State : ${dbStatus === "online" ? "Online" : "Offline"}` : ""}></div>
            {!isSidebarCollapsed && <span> SQLite State : {dbStatus === "online" ? "Online" : "Offline"}</span>}
          </div>
          {acpSessionId && (
            <div className="status-indicator" style={{ marginTop: "4px", justifyContent: isSidebarCollapsed ? "center" : "flex-start" }}>
              <div className={`dot ${isAcpSessionCreated ? "" : "busy"}`} title={isSidebarCollapsed ? `ACP Agent : ${isAcpInitialized ? "Active" : "Spawning"}` : ""}></div>
              {!isSidebarCollapsed && <span> ACP Agent : {isAcpInitialized ? "Active" : "Spawning"}</span>}
            </div>
          )}
        </div>
      </aside>

      {/* 2. Main Dashboard Content Area */}
      <main className="main-content">
        
        {/* Tab 0: Smart Workspace Chat UI */}
        {activeTab === "chat" && (
          <div className="chat-window" style={{ height: "100%", overflow: "hidden" }}>
            <div className="dashboard-header">
              <h2 className="dashboard-title">💬 智能工作区与多模式对话系统</h2>
              <p className="dashboard-subtitle">以本地项目或 GitHub 仓库为上下文，调度 SQLite 持久化注册的 AI 智能体，流式协同开发。</p>
            </div>

            <div className="panel" style={{ padding: 0, flexDirection: "row", overflow: "hidden", flexGrow: 1, minWidth: 0 }}>
              {/* Left Sub-sidebar: Chat Tree History & Workspace */}
              <div className="agent-selector-sidebar" style={{ width: "320px", minWidth: "320px", maxWidth: "320px", flexShrink: 0, borderRight: "1px solid var(--cyber-border)", display: "flex", flexDirection: "column", padding: "16px", background: "rgba(3, 4, 8, 0.4)", backdropFilter: "blur(20px)" }}>
                {/* Workspace Switcher */}
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", textTransform: "uppercase", fontWeight: "600", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--cyber-secondary)" }}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    当前工作区目录
                  </div>
                  <div 
                    style={{ 
                      display: "flex", 
                      alignItems: "center", 
                      background: "rgba(5, 6, 12, 0.55)", 
                      border: "1px solid var(--cyber-border)", 
                      borderRadius: "20px", 
                      padding: "4px 6px",
                      transition: "all 0.25s",
                      boxShadow: "inset 0 1px 4px rgba(0, 0, 0, 0.3)"
                    }}
                    className="workspace-pill-container"
                  >
                    <input 
                      value={workspacePath} 
                      onChange={e => setWorkspacePath(e.target.value)} 
                      style={{ 
                        fontSize: "0.8rem", 
                        background: "transparent", 
                        border: "none", 
                        color: "#fff",
                        flexGrow: 1, 
                        padding: "4px 8px",
                        outline: "none",
                        fontFamily: "inherit"
                      }}
                      placeholder="输入或选择工作区..."
                    />
                    <button 
                      onClick={handleChooseWorkspace} 
                      style={{ 
                        background: "rgba(88, 51, 255, 0.2)", 
                        border: "1px solid rgba(88, 51, 255, 0.3)", 
                        color: "#9d7fff", 
                        borderRadius: "14px",
                        padding: "4px 10px", 
                        fontSize: "0.75rem", 
                        display: "flex", 
                        alignItems: "center", 
                        gap: "4px", 
                        fontWeight: "600",
                        cursor: "pointer",
                        transition: "all 0.2s"
                      }}
                      className="pill-btn-purple"
                      title="选择工作区目录"
                    >
                      选择
                    </button>
                    <button 
                      onClick={scanWorkspaceFiles} 
                      style={{ 
                        background: "rgba(0, 242, 254, 0.15)", 
                        border: "1px solid rgba(0, 242, 254, 0.3)", 
                        color: "#00f2fe",
                        borderRadius: "50%",
                        width: "24px",
                        height: "24px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 0,
                        marginLeft: "4px",
                        cursor: "pointer",
                        transition: "all 0.2s"
                      }}
                      className="pill-btn-cyan"
                      title="重新扫描工作区"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                    </button>
                  </div>
                </div>

                {/* [+ New Conversation] */}
                <button className="btn" onClick={handleCreateNewChat} style={{ width: "100%", background: "linear-gradient(135deg, rgba(0, 242, 254, 0.15), rgba(88, 51, 255, 0.15))", border: "1px solid rgba(0, 242, 254, 0.4)", color: "#00f2fe", fontWeight: "600", marginBottom: "16px", display: "flex", justifyContent: "center", alignItems: "center", gap: "8px", borderRadius: "18px", transition: "all 0.25s" }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.122 2.122 0 1 1 3 3L12 15l-4 1 1-4Z"/></svg>
                  新建对话
                </button>

                {/* Conversation List / Folder Tree */}
                <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", fontWeight: "600", marginBottom: "8px", textTransform: "uppercase", paddingLeft: "4px" }}>
                  会话历史 (Chats)
                </div>
                <div className="templates-scroll-area" style={{ flexGrow: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px" }}>
                  {chatSessions.length === 0 ? (
                    <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", padding: "12px", fontStyle: "italic", textAlign: "center" }}>
                      暂无历史对话记录
                    </div>
                  ) : (() => {
                    const { groups, sortedPaths } = getGroupedSessions();
                    return sortedPaths.map(path => (
                      <div key={path} style={{ display: "flex", flexDirection: "column", gap: "6px", background: "rgba(255, 255, 255, 0.01)", border: "1px solid rgba(255, 255, 255, 0.02)", borderRadius: "8px", padding: "8px" }}>
                        {/* Folder Group Header */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 4px 6px 4px", borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: "4px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "rgba(255,255,255,0.7)", fontWeight: "600", fontSize: "0.85rem", textTransform: "none" }}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "rgba(0, 242, 254, 0.7)" }}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                            {path.split("/").pop() || "未知工作区"}
                          </div>
                          {path !== "未知工作区" && (
                            <button 
                              onClick={(e) => {
                                  e.stopPropagation();
                                  handleCreateNewChatInWorkspace(path);
                              }}
                              className="btn"
                              style={{ 
                                padding: "2px 8px", 
                                fontSize: "0.7rem", 
                                background: "rgba(0, 242, 254, 0.12)", 
                                border: "1px solid rgba(0, 242, 254, 0.25)", 
                                color: "#00f2fe", 
                                borderRadius: "10px",
                                cursor: "pointer",
                                transition: "all 0.2s",
                                display: "flex",
                                alignItems: "center",
                                gap: "2px",
                                fontWeight: "600"
                              }}
                              title="在此目录下新建对话"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "2px" }}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                              新建
                            </button>
                          )}
                        </div>
                        {/* Sessions inside this folder */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          {groups[path].map(session => (
                            <div 
                              key={session.id} 
                              className={`template-item ${activeSessionId === session.id ? "active" : ""}`}
                              onClick={() => handleSelectSession(session.id)}
                              style={{ padding: "8px 10px", borderRadius: "6px", cursor: "pointer", transition: "all 0.2s", display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative" }}
                            >
                              <div style={{ display: "flex", gap: "8px", alignItems: "center", overflow: "hidden", marginRight: "12px" }}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "rgba(255, 255, 255, 0.3)", flexShrink: 0 }}><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                                <span style={{ fontSize: "0.85rem", color: "#fff", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                                  {session.title}
                                </span>
                              </div>
                              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                                <span style={{ fontSize: "0.75rem", color: "var(--text-dim)", whiteSpace: "nowrap" }}>
                                  {formatTimeAgo(session.updated_at)}
                                </span>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id); }} 
                                  style={{ background: "transparent", border: "none", color: "rgba(255,0,0,0.5)", cursor: "pointer", padding: "2px", fontSize: "0.9rem", display: "flex", alignItems: "center" }}
                                  title="删除会话"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="trash-icon-svg" style={{ color: "rgba(255, 0, 127, 0.4)", transition: "all 0.2s" }}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>

              {/* Right Area: Chat Hub */}
              <div className="agent-configuration-panel" style={{ flex: "1 1 0%", minWidth: 0, flexShrink: 1, padding: "24px", display: "flex", flexDirection: "column", justifyContent: "space-between", overflow: "hidden", background: "rgba(5, 6, 12, 0.2)", backdropFilter: "blur(4px)" }}>
                
                {/* 1. Header & Modes Switcher */}
                <div style={{ borderBottom: "1px solid var(--cyber-border)", paddingBottom: "16px", marginBottom: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>智能体协同空间</div>
                    <h3 style={{ margin: "4px 0 0 0", fontSize: "1.2rem", fontWeight: "700" }}>
                      {chatMessages.length === 0 ? "和 Agent 聊聊吧" : chatSessions.find(s => s.id === activeSessionId)?.title || "会话详情"}
                    </h3>
                  </div>

                  {/* Mode Tab pill */}
                  <div style={{ display: "flex", background: "rgba(0, 0, 0, 0.4)", border: "1px solid var(--cyber-border)", borderRadius: "20px", padding: "3px 6px", gap: "4px" }}>
                    <button 
                      onClick={() => setChatMode("local")} 
                      style={{ border: "none", background: chatMode === "local" ? "linear-gradient(135deg, #00f2fe, var(--cyber-primary))" : "transparent", color: "#fff", borderRadius: "16px", padding: "6px 14px", fontSize: "0.8rem", cursor: "pointer", transition: "all 0.2s" }}
                    >
                      📁 本地项目
                    </button>
                    <button 
                      onClick={() => setChatMode("github")} 
                      style={{ border: "none", background: chatMode === "github" ? "linear-gradient(135deg, #00f2fe, var(--cyber-primary))" : "transparent", color: "#fff", borderRadius: "16px", padding: "6px 14px", fontSize: "0.8rem", cursor: "pointer", transition: "all 0.2s" }}
                    >
                      🐱 GitHub 仓库
                    </button>
                    <button 
                      onClick={() => setChatMode("free")} 
                      style={{ border: "none", background: chatMode === "free" ? "linear-gradient(135deg, #00f2fe, var(--cyber-primary))" : "transparent", color: "#fff", borderRadius: "16px", padding: "6px 14px", fontSize: "0.8rem", cursor: "pointer", transition: "all 0.2s" }}
                    >
                      💬 自由对话
                    </button>
                  </div>
                </div>

                {/* 2. Messages Threads & Empty State */}
                <div 
                  ref={chatContainerRef}
                  style={{ flexGrow: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "16px", paddingBottom: "20px" }}
                >

                  {chatMessages.length === 0 ? (
                    <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", opacity: 0.85, transform: "translateY(-10px)" }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--cyber-secondary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: "20px", filter: "drop-shadow(0 0 8px rgba(0, 242, 254, 0.5))" }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                      <h2 style={{ fontSize: "1.8rem", color: "#fff", margin: "8px 0", fontWeight: "700" }}>和 Agent 开启极速会话</h2>
                      <p style={{ fontSize: "0.95rem", color: "var(--text-dim)", maxWidth: "480px", textAlign: "center", lineHeight: "1.6" }}>
                        输入指令，AI 运行时将全量接入本地 Stdio 与工程，支持文件级读取、重构和编写。输入 `@` 提及特定代码文件。
                      </p>
                    </div>
                  ) : (
                    chatMessages.map((msg, index) => (
                      <div 
                        key={index} 
                        style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start", width: "100%" }}
                      >
                        <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginBottom: "4px", padding: "0 8px" }}>
                          {msg.role === "user" ? "Kylin" : "Agent"} • {msg.timestamp}
                        </div>
                        <div 
                          className="chat-bubble"
                          style={{ 
                            position: "relative",
                            maxWidth: "85%", 
                            padding: "12px 38px 12px 18px", 
                            borderRadius: "14px", 
                            lineHeight: "1.6",
                            fontSize: "0.95rem",
                            background: msg.role === "user" 
                              ? "linear-gradient(135deg, rgba(0, 242, 254, 0.15), rgba(88, 51, 255, 0.15))" 
                              : "rgba(255, 255, 255, 0.03)",
                            border: msg.role === "user" 
                              ? "1px solid rgba(0, 242, 254, 0.3)" 
                              : "1px solid rgba(255, 255, 255, 0.05)",
                            backdropFilter: "blur(10px)",
                            color: "#fff",
                            wordBreak: "break-word"
                          }}
                        >
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              code({ node, inline, className, children, ...props }: any) {
                                const match = /language-(\w+)/.exec(className || '');
                                return !inline && match ? (
                                  <SyntaxHighlighter
                                    style={vscDarkPlus as any}
                                    language={match[1]}
                                    PreTag="div"
                                    {...props}
                                  >
                                    {String(children).replace(/\n$/, '')}
                                  </SyntaxHighlighter>
                                ) : (
                                  <code className={className} {...props}>
                                    {children}
                                  </code>
                                );
                              },
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                          
                          {/* Copy Button */}
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(msg.content);
                              setCopiedIndex(index);
                              setTimeout(() => setCopiedIndex(null), 1500);
                            }}
                            style={{
                              position: "absolute",
                              top: "8px",
                              right: "8px",
                              background: "rgba(255, 255, 255, 0.03)",
                              border: "1px solid rgba(255, 255, 255, 0.08)",
                              borderRadius: "6px",
                              padding: "4px",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "rgba(255, 255, 255, 0.4)",
                              transition: "all 0.2s"
                            }}
                            className="bubble-copy-btn"
                            title="复制内容"
                          >
                            {copiedIndex === index ? (
                              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#00e676" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ filter: "drop-shadow(0 0 3px #00e676)" }}><polyline points="20 6 9 17 4 12"/></svg>
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            )}
                          </button>
                        </div>
                      </div>
                    ))
                  )}

                  {/* Flowing Thinking Stream */}
                  {chatThinkingStream && (
                    <div style={{ background: "rgba(0, 242, 254, 0.02)", border: "1px solid rgba(0, 242, 254, 0.1)", borderRadius: "10px", padding: "12px 16px", fontSize: "0.85rem", color: "var(--text-dim)", fontFamily: "Fira Code, monospace" }}>
                      <details open={isThinkingFlowOpen} onToggle={(e: any) => setIsThinkingFlowOpen(e.target.open)}>
                        <summary style={{ color: "#00f2fe", fontWeight: "600", cursor: "pointer", userSelect: "none" }}>
                          🧠 Stdio 管道思考流 (Thinking Process...)
                        </summary>
                        <pre 
                          ref={thinkingPreRef}
                          style={{ margin: "8px 0 0 0", whiteSpace: "pre-wrap", overflowX: "auto", color: "#8c9eff", maxHeight: "150px", overflowY: "auto" }}
                        >
                          {chatThinkingStream}
                        </pre>
                      </details>
                    </div>
                  )}
                </div>

                {/* 3. Input Panel Box with Autocomplete and Actions */}
                <div style={{ position: "relative", borderTop: "1px solid var(--cyber-border)", paddingTop: "16px" }}>
                  
                  {/* Autocomplete Overlay */}
                  {showAutocomplete && (
                    <div 
                      className="autocomplete-card"
                      style={{ 
                        position: "absolute", 
                        bottom: "100%", 
                        left: "0", 
                        width: "100%", 
                        background: "rgba(10, 11, 20, 0.95)", 
                        border: "1px solid var(--cyber-border-active)", 
                        borderRadius: "10px", 
                        boxShadow: "0 -4px 20px rgba(0,0,0,0.5)", 
                        padding: "8px", 
                        marginBottom: "8px", 
                        maxHeight: "220px", 
                        overflowY: "auto", 
                        zIndex: 100,
                        backdropFilter: "blur(20px)"
                      }}
                    >
                      <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", padding: "4px 8px", borderBottom: "1px solid var(--cyber-border)", marginBottom: "6px", fontWeight: "600" }}>
                        🔍 选择工作区文件进行提及 (Press Up/Down to navigate)
                      </div>
                      {workspaceFiles.filter(f => f.toLowerCase().includes(autocompleteQuery)).length === 0 ? (
                        <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", padding: "8px", fontStyle: "italic" }}>
                          未找到匹配文件 (扫描了 {workspaceFiles.length} 个文件)
                        </div>
                      ) : (
                        workspaceFiles
                          .filter(f => f.toLowerCase().includes(autocompleteQuery))
                          .slice(0, 10)
                          .map((file, idx) => (
                            <div 
                              key={file} 
                              onClick={() => handleSelectAutocompleteFile(file)}
                              className={`autocomplete-item ${autocompleteSelectedIndex === idx ? "active" : ""}`}
                              style={{ 
                                padding: "8px 12px", 
                                borderRadius: "6px", 
                                cursor: "pointer", 
                                fontSize: "0.85rem", 
                                color: autocompleteSelectedIndex === idx ? "#00f2fe" : "#fff",
                                background: autocompleteSelectedIndex === idx ? "rgba(0, 242, 254, 0.1)" : "transparent",
                                transition: "all 0.15s"
                              }}
                            >
                              📄 {file}
                            </div>
                          ))
                      )}
                    </div>
                  )}

                  {/* Input Card Container */}
                  <div style={{ background: "rgba(15, 16, 26, 0.5)", border: "1px solid var(--cyber-border)", borderRadius: "12px", padding: "12px 16px", backdropFilter: "blur(10px)", display: "flex", flexDirection: "column", gap: "10px" }}>
                    
                    {/* Top line of input: workspace info */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.75rem", color: "var(--text-dim)" }}>
                      <span>📁 workspace: {workspacePath.split("/").pop()} ({chatMode} mode) • {chatStatus === "spawning" ? "⚡ 唤醒中..." : chatStatus === "running" ? "🟢 互动中" : "💤 空闲"}</span>
                      <span>{showAutocomplete ? "Type to search..." : "按 '@' 提及项目代码文件"}</span>
                    </div>

                    {/* Text input area */}
                    <textarea 
                      className="chat-input"
                      placeholder="和 AI 智能体聊聊，输入 '@' 提及文件..."
                      value={chatMessageInput}
                      onChange={e => setChatMessageInput(e.target.value)}
                      onKeyDown={handleChatInputKeyDown}
                      style={{ 
                        background: "transparent", 
                        border: "none", 
                        resize: "none", 
                        minHeight: "60px", 
                        padding: 0, 
                        width: "100%", 
                        fontSize: "0.95rem", 
                        lineHeight: "1.5",
                        color: "#fff"
                      }}
                    />

                    {/* Bottom toolbar */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: "10px" }}>
                      
                      {/* Select Agent dropdown */}
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>🤖 调度:</span>
                          <select 
                            value={selectedAgentForChat}
                            onChange={e => setSelectedAgentForChat(e.target.value)}
                            className="form-input" 
                            style={{ 
                              padding: "4px 10px", 
                              fontSize: "0.8rem", 
                              background: "rgba(10,11,20,0.6)", 
                              border: "1px solid var(--cyber-border)",
                              color: "#00f2fe",
                              borderRadius: "16px",
                              cursor: "pointer",
                              fontWeight: "600",
                              outline: "none"
                            }}
                          >
                            {registeredAgents.map(a => (
                              <option key={a.agent_id} value={a.agent_id}>
                                🟢 {a.name}
                              </option>
                            ))}
                            {registeredAgents.length === 0 && (
                              <option value="claude-code">🟢 Claude Code (Default)</option>
                            )}
                          </select>
                        </div>

                        {/* Mode Selector for Gemini CLI */}
                        {(selectedAgentForChat.toLowerCase().includes("gemini") || selectedAgentForChat === "gemini-cli") && (
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>⚡ 模式:</span>
                            <select 
                              value={geminiMode}
                              onChange={e => setGeminiMode(e.target.value as any)}
                              className="form-input" 
                              style={{ 
                                padding: "4px 10px", 
                                fontSize: "0.8rem", 
                                background: "rgba(10,11,20,0.6)", 
                                border: "1px solid var(--cyber-border)",
                                color: geminiMode === "yolo" ? "var(--cyber-accent)" : geminiMode === "auto edit" ? "#00e676" : "#00f2fe",
                                borderRadius: "16px",
                                cursor: "pointer",
                                fontWeight: "600",
                                outline: "none"
                              }}
                              title="选择 Gemini CLI 运行模式"
                            >
                              <option value="plan">Plan 模式</option>
                              <option value="auto edit">Auto Edit 模���</option>
                              <option value="yolo">YOLO 模式</option>
                            </select>
                          </div>
                        )}
                      </div>

                      {/* Right side actions */}
                      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                        <span style={{ fontSize: "0.75rem", color: "#00ff66", fontWeight: "600" }}>🔒 完全访问</span>
                        <button 
                          className="btn" 
                          onClick={() => {
                            if (workspaceFiles.length > 0) {
                              setChatMessageInput(prev => prev + "@");
                            } else {
                              scanWorkspaceFiles().then(() => setChatMessageInput(prev => prev + "@"));
                            }
                          }}
                          style={{ padding: "6px 12px", background: "transparent", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "18px", color: "var(--text-dim)", fontSize: "0.75rem" }}
                          title="提及文件"
                        >
                          📎 提及
                        </button>
                        {chatStatus === "running" || chatStatus === "spawning" ? (
                          <button 
                            onClick={handleStopChatMessage}
                            style={{ 
                              display: "flex", 
                              justifyContent: "center", 
                              alignItems: "center", 
                              width: "36px", 
                              height: "36px", 
                              borderRadius: "50%", 
                              border: "none", 
                              background: "linear-gradient(135deg, #ff0844, #ffb199)",
                              color: "#fff",
                              cursor: "pointer",
                              transition: "all 0.2s",
                              boxShadow: "0 0 10px rgba(255, 8, 68, 0.4)"
                            }}
                            title="停止生成 (Stop)"
                          >
                            ⏹
                          </button>
                        ) : (
                          <button 
                            onClick={handleSendChatMessage}
                            disabled={!chatMessageInput.trim()}
                            style={{ 
                              display: "flex", 
                              justifyContent: "center", 
                              alignItems: "center", 
                              width: "36px", 
                              height: "36px", 
                              borderRadius: "50%", 
                              border: "none", 
                              background: chatMessageInput.trim() ? "linear-gradient(135deg, #00f2fe, var(--cyber-primary))" : "rgba(255,255,255,0.05)",
                              color: chatMessageInput.trim() ? "#fff" : "rgba(255,255,255,0.25)",
                              cursor: chatMessageInput.trim() ? "pointer" : "not-allowed",
                              transition: "all 0.2s"
                            }}
                            title="发送 (Send)"
                          >
                            ↑
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 1: Memory CRDT Document System */}
        {activeTab === "memory" && (
          <div className="chat-window">
            <div className="dashboard-header">
              <h2 className="dashboard-title">🧠 记忆系统 & CRDT 文档存取</h2>
              <p className="dashboard-subtitle">通过 Loro CRDT 引擎序列化，在 SQLite 中实现防碎片残余的高速全量保存。</p>
            </div>

            <div className="panel">
              <div className="settings-grid" style={{ marginBottom: "16px", gridTemplateColumns: "1fr 2fr" }}>
                <div className="form-group">
                  <label className="form-label">会话 ID (Loro Unique ID)</label>
                  <input
                    className="form-input"
                    value={sessionId}
                    onChange={(e) => setSessionId(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">会话标题</label>
                  <input
                    className="form-input"
                    value={sessionTitle}
                    onChange={(e) => setSessionTitle(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group" style={{ flexGrow: 1, display: "flex", flexDirection: "column" }}>
                <label className="form-label">Markdown 记录编辑区</label>
                <textarea
                  className="form-input"
                  style={{ flexGrow: 1, minHeight: "220px", fontFamily: "Fira Code, monospace", fontSize: "0.9rem", resize: "none" }}
                  value={markdownContent}
                  onChange={(e) => setMarkdownContent(e.target.value)}
                />
              </div>

              {memoryStatus && (
                <div style={{ padding: "8px 12px", borderRadius: "6px", background: "rgba(255,255,255,0.05)", fontSize: "0.85rem", marginBottom: "12px", color: "#00ff66" }}>
                  {memoryStatus}
                </div>
              )}

              <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
                <button className="btn" onClick={handleSaveMemory}>
                  💾 保存二进制快照 (Save Snapshot)
                </button>
                <button className="btn btn-secondary" onClick={handleLoadMemory}>
                  🔄 反序列化载入 (Load Snapshot)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Agent Manager (🤖 智能体管理中心) */}
        {activeTab === "agentManager" && (
          <div className="chat-window" style={{ height: "100%" }}>
            <div className="dashboard-header">
              <h2 className="dashboard-title">🤖 智能体中心 (Agent Manager)</h2>
              <p className="dashboard-subtitle">注册并测试外部物理智能体进程，成功就绪后一键存入本地 SQLite 数据列表。</p>
            </div>

            <div className="panel" style={{ padding: 0, flexDirection: "row", overflow: "hidden", flexGrow: 1 }}>
              {/* Left Column: Select Type (选择类型) */}
              <div className="agent-selector-sidebar" style={{ width: "300px", borderRight: "1px solid var(--cyber-border)", display: "flex", flexDirection: "column", padding: "16px", background: "rgba(3, 4, 8, 0.3)" }}>
                <div className="form-group" style={{ marginBottom: "16px" }}>
                  <input
                    className="form-input search-input"
                    placeholder="🔍 搜索内置/预设智能体..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ background: "rgba(5, 6, 12, 0.6)" }}
                  />
                </div>

                <div className="templates-scroll-area" style={{ flexGrow: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" }}>
                  {/* Action: Custom Agent Entry */}
                  <div className="category-section" style={{ marginBottom: "8px" }}>
                    <div
                      className={`template-item ${selectedTemplate.id === "custom-agent" ? "active" : ""}`}
                      onClick={() => handleSelectTemplate({
                        id: "custom-agent",
                        name: "自定义智能体 (Custom Agent)",
                        category: "custom",
                        recommendedPath: "",
                        recommendedArgs: "",
                        recommendedEnvKey: "",
                        recommendedEnvVal: "",
                        description: "注册任何支持标准输入输出或符合 ACP 协议的智能体可执行路径",
                        title: "自定义智能体配置"
                      })}
                      style={{
                        padding: "12px",
                        borderRadius: "8px",
                        cursor: "pointer",
                        background: selectedTemplate.id === "custom-agent" 
                          ? "linear-gradient(135deg, var(--cyber-primary), var(--cyber-secondary))" 
                          : "rgba(88, 51, 255, 0.1)",
                        border: "1px dashed var(--cyber-primary)",
                        color: "#fff",
                        fontWeight: "600",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                        fontSize: "0.95rem",
                        boxShadow: selectedTemplate.id === "custom-agent" ? "0 0 15px rgba(88, 51, 255, 0.4)" : "none",
                        transition: "all 0.2s"
                      }}
                    >
                      ➕ 注册自定义智能体
                    </div>
                  </div>

                  {/* Category: Built-in */}
                  <div className="category-section">
                    <div className="category-title" style={{ fontSize: "0.8rem", color: "var(--text-dim)", fontWeight: "600", textTransform: "uppercase", marginBottom: "6px", paddingLeft: "4px" }}>内置 (Built-in)</div>
                    {AGENT_TEMPLATES.filter(t => t.category === "built-in" && t.name.toLowerCase().includes(searchQuery.toLowerCase())).map(tpl => (
                      <div
                        key={tpl.id}
                        className={`template-item ${selectedTemplate.id === tpl.id ? "active" : ""}`}
                        onClick={() => handleSelectTemplate(tpl)}
                        style={{ padding: "10px 12px", borderRadius: "8px", cursor: "pointer", transition: "all 0.2s", marginBottom: "4px", fontSize: "0.9rem" }}
                      >
                        🌟 {tpl.name}
                      </div>
                    ))}
                  </div>

                  {/* Category: Presets */}
                  <div className="category-section">
                    <div className="category-title" style={{ fontSize: "0.8rem", color: "var(--text-dim)", fontWeight: "600", textTransform: "uppercase", marginBottom: "6px", paddingLeft: "4px" }}>预设 (Presets)</div>
                    {AGENT_TEMPLATES.filter(t => t.category === "preset" && t.name.toLowerCase().includes(searchQuery.toLowerCase())).map(tpl => (
                      <div
                        key={tpl.id}
                        className={`template-item ${selectedTemplate.id === tpl.id ? "active" : ""}`}
                        onClick={() => handleSelectTemplate(tpl)}
                        style={{ padding: "10px 12px", borderRadius: "8px", cursor: "pointer", transition: "all 0.2s", marginBottom: "4px", fontSize: "0.9rem" }}
                      >
                        💎 {tpl.name}
                      </div>
                    ))}
                  </div>

                  {/* Category: ACP Registry */}
                  <div className="category-section">
                    <div className="category-title" style={{ fontSize: "0.8rem", color: "var(--text-dim)", fontWeight: "600", textTransform: "uppercase", marginBottom: "6px", paddingLeft: "4px" }}>ACP 注册表</div>
                    {AGENT_TEMPLATES.filter(t => t.category === "acp" && t.name.toLowerCase().includes(searchQuery.toLowerCase())).map(tpl => (
                      <div
                        key={tpl.id}
                        className={`template-item ${selectedTemplate.id === tpl.id ? "active" : ""}`}
                        onClick={() => handleSelectTemplate(tpl)}
                        style={{ padding: "10px 12px", borderRadius: "8px", cursor: "pointer", transition: "all 0.2s", marginBottom: "4px", fontSize: "0.9rem" }}
                      >
                        🔌 {tpl.name}
                      </div>
                    ))}
                  </div>

                  {/* SQLite Registered list */}
                  <div className="category-section" style={{ marginTop: "16px", borderTop: "1px solid var(--cyber-border)", paddingTop: "16px" }}>
                    <div className="category-title" style={{ fontSize: "0.8rem", color: "#00e676", fontWeight: "600", textTransform: "uppercase", marginBottom: "8px", paddingLeft: "4px" }}>已注册智能体 ({registeredAgents.length})</div>
                    {registeredAgents.length === 0 ? (
                      <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", paddingLeft: "4px", fontStyle: "italic" }}>暂无成功就绪注册项</div>
                    ) : (
                      registeredAgents.map(agent => (
                        <div
                          key={agent.agent_id}
                          className="registered-item"
                          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: "6px", background: "rgba(255,255,255,0.02)", marginBottom: "4px", fontSize: "0.85rem" }}
                        >
                          <span style={{ color: "#fff", fontWeight: "500" }}>🟢 {agent.name}</span>
                          <button
                            className="btn btn-secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteAgent(agent.agent_id);
                            }}
                            style={{ padding: "2px 6px", fontSize: "0.75rem", background: "rgba(255, 0, 127, 0.1)", border: "1px solid rgba(255, 0, 127, 0.3)", color: "var(--cyber-accent)" }}
                          >
                            注销
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: Configure Provider (新建 Provider) */}
              <div className="agent-configuration-panel" style={{ flexGrow: 1, padding: "24px", display: "flex", flexDirection: "column", justifyContent: "space-between", overflowY: "auto" }}>
                <div style={{ flexGrow: 1 }}>
                  {/* Top Bar: Title & Testing status */}
                  <div className="provider-header-bar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--cyber-border)", paddingBottom: "16px", marginBottom: "20px" }}>
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>新建 Provider</div>
                      <h3 style={{ margin: "4px 0 0 0", fontSize: "1.2rem", fontWeight: "700" }}>{selectedTemplate.name} 运行时</h3>
                    </div>
                    <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                      <button
                        className="btn btn-secondary"
                        onClick={handleTestAgent}
                        disabled={testStatus === "testing"}
                        style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: "6px" }}
                        title="测试可用性"
                      >
                        🔄 {testStatus === "testing" ? "测试中" : "检测"}
                      </button>
                      <span className={`status-badge-pill ${testStatus}`}>
                        {testStatus === "none" && "🟡 未检测"}
                        {testStatus === "testing" && "🔵 检测中..."}
                        {testStatus === "ready" && "🟢 就绪"}
                        {testStatus === "failed" && "🔴 不���用"}
                      </span>
                    </div>
                  </div>

                  {/* Form fields */}
                  <div className="form-group" style={{ marginBottom: "16px" }}>
                    <label className="form-label">配置名称</label>
                    <input
                      className="form-input"
                      placeholder="例如: Anthropic Claude Code 运行时"
                      value={configName}
                      onChange={(e) => setConfigName(e.target.value)}
                    />
                    <span style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginTop: "4px" }}>显示在 provider 列表和会话菜单中。</span>
                  </div>

                  <div className="settings-grid" style={{ gridTemplateColumns: "2fr 1fr", gap: "16px", marginBottom: "16px" }}>
                    <div className="form-group">
                      <label className="form-label">可执行程序路径 (Command/Path)</label>
                      <input
                        className="form-input"
                        placeholder="例如: claude 或 npx"
                        value={execPathInput}
                        onChange={(e) => setExecPathInput(e.target.value)}
                        style={{ fontFamily: "Fira Code, monospace" }}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">运行检测参数 (Args)</label>
                      <input
                        className="form-input"
                        placeholder="例如: --acp"
                        value={argsInputVal}
                        onChange={(e) => setArgsInputVal(e.target.value)}
                        style={{ fontFamily: "Fira Code, monospace" }}
                      />
                    </div>
                  </div>

                  {/* Collapsible Section: Environment variables */}
                  <div className="collapsible-card" style={{ background: "rgba(5, 6, 12, 0.2)", border: "1px solid var(--cyber-border)", borderRadius: "10px", padding: "16px", marginBottom: "20px" }}>
                    <div style={{ fontWeight: "600", fontSize: "0.9rem", color: "#fff", marginBottom: "12px" }}>⚙️ 关联运行环境变量</div>
                    <div className="settings-grid" style={{ gridTemplateColumns: "1fr 2fr", gap: "12px" }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: "0.8rem" }}>变量 Key</label>
                        <input
                          className="form-input"
                          placeholder="例如: ANTHROPIC_API_KEY"
                          value={envKeyInput}
                          onChange={(e) => setEnvKeyInput(e.target.value)}
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: "0.8rem" }}>变量 Value (Token/密钥)</label>
                        <input
                          className="form-input"
                          type="password"
                          placeholder="安全存储在 SQLite 中..."
                          value={envValInput}
                          onChange={(e) => setEnvValInput(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Description Box */}
                  <div style={{ background: "rgba(88, 51, 255, 0.04)", border: "1px solid rgba(88, 51, 255, 0.15)", padding: "12px 16px", borderRadius: "8px", fontSize: "0.85rem", color: "var(--text-dim)", marginBottom: "20px", lineHeight: "1.5" }}>
                    <b>💡 智能体简���</b>：{selectedTemplate.description}。
                  </div>

                  {/* Test output block */}
                  {testOutput && (
                    <div className="terminal" style={{ height: "120px", padding: "12px", fontSize: "0.8rem", marginBottom: "20px", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div style={{ color: "#8c9eff", fontWeight: "600", marginBottom: "4px" }}>检测流输出:</div>
                      <div style={{ whiteSpace: "pre-wrap", color: testStatus === "ready" ? "#00ff66" : testStatus === "failed" ? "var(--cyber-accent)" : "#fff" }}>
                        {testOutput}
                      </div>
                    </div>
                  )}

                  {agentCenterStatus && (
                    <div style={{ padding: "10px 14px", borderRadius: "6px", background: "rgba(0, 242, 254, 0.08)", border: "1px solid rgba(0, 242, 254, 0.2)", fontSize: "0.85rem", marginBottom: "20px", color: "#00f2fe" }}>
                      {agentCenterStatus}
                    </div>
                  )}
                </div>

                {/* Footer action buttons */}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", borderTop: "1px solid var(--cyber-border)", paddingTop: "16px", marginTop: "16px" }}>
                  <button className="btn btn-secondary" onClick={() => handleSelectTemplate(selectedTemplate)}>
                    取消 (Reset)
                  </button>
                  <button
                    className="btn"
                    onClick={handleSaveAgent}
                    disabled={testStatus !== "ready"}
                    style={{ background: testStatus === "ready" ? "linear-gradient(135deg, #00f2fe, var(--cyber-primary))" : "rgba(255,255,255,0.05)", color: testStatus === "ready" ? "#fff" : "rgba(255,255,255,0.25)" }}
                  >
                    🚀 创建并加入智能体列表 (Create)
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Agent Dispatcher (Stdio terminal monitor) */}
        {activeTab === "agent" && (
          <div className="chat-window">
            <div className="dashboard-header">
              <h2 className="dashboard-title">🔌 子智能体调度 & 实时 Stdio 控制台</h2>
              <p className="dashboard-subtitle">利用 Rust Tokio::process 管道无背压控制外部进程，通过 Stdio 获取流式 Thinking 分析。</p>
            </div>

            <div className="panel" style={{ gap: "16px" }}>
              {/* SELECT DRAWER FOR REGISTERED AGENTS */}
              <div className="form-group" style={{ marginBottom: "4px" }}>
                <label className="form-label" style={{ color: "#00f2fe" }}>🤖 快速载入就绪智能体 (Select Registered Agent)</label>
                <select
                  className="form-input"
                  value={selectedRegistryId}
                  onChange={(e) => handleSelectRegistryAgent(e.target.value)}
                  style={{ background: "#0a0b10", border: "1px solid var(--cyber-border-active)", color: "#00f2fe", fontWeight: "600" }}
                >
                  <option value="custom">[ 🛠️ 手动输入自定义运行参数... ]</option>
                  {registeredAgents.map(a => (
                    <option key={a.agent_id} value={a.agent_id}>🟢 {a.name} ({a.path})</option>
                  ))}
                </select>
              </div>

              <div className="settings-grid" style={{ gridTemplateColumns: "1fr 2fr 1.5fr" }}>
                <div className="form-group">
                  <label className="form-label">子智能体 ID</label>
                  <input
                    className="form-input"
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                    disabled={selectedRegistryId !== "custom"}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">执行程序命令 (Command/Path)</label>
                  <input
                    className="form-input"
                    value={execPath}
                    onChange={(e) => setExecPath(e.target.value)}
                    disabled={selectedRegistryId !== "custom"}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">参数列表 (Arguments)</label>
                  <input
                    className="form-input"
                    value={argsInput}
                    onChange={(e) => setArgsInput(e.target.value)}
                  />
                </div>
              </div>

              <div className="settings-grid" style={{ gridTemplateColumns: "1fr 2.5fr" }}>
                <div className="form-group">
                  <label className="form-label">环境变量 Key</label>
                  <input
                    className="form-input"
                    value={envKey}
                    onChange={(e) => setEnvKey(e.target.value)}
                    disabled={selectedRegistryId !== "custom"}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">环境变量 Value</label>
                  <input
                    className="form-input"
                    type="password"
                    value={envVal}
                    onChange={(e) => setEnvVal(e.target.value)}
                    disabled={selectedRegistryId !== "custom"}
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: "12px" }}>
                <button className="btn" onClick={handleStartAgent} disabled={isAgentRunning}>
                  ⚡ 启动进程 (Spawn Agent)
                </button>
                <button className="btn btn-accent" onClick={handleKillAgent} disabled={!isAgentRunning}>
                  🛑 停止进程 (Kill Agent)
                </button>
              </div>

              {/* Glowing Terminal Screen */}
              <div className="terminal">
                <div className="terminal-header">
                  <span>SYSTEM_SHELL@AIDE: ~</span>
                  <span>PID: {isAgentRunning ? "Active" : "Inactive"}</span>
                </div>
                
                {terminalLines.map((line, idx) => (
                  <div key={idx} className={`terminal-line ${line.type}`}>
                    [{line.timestamp}] {line.text}
                  </div>
                ))}
                <div ref={terminalEndRef} />
              </div>

              {/* Stdin command dispatcher */}
              <div className="chat-input-bar">
                <input
                  className="chat-input"
                  placeholder="向子智能体的 Stdio 管道写入指令..."
                  value={stdinMessage}
                  onChange={(e) => setStdinMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleWriteStdin();
                  }}
                  disabled={!isAgentRunning}
                />
                <button className="btn" onClick={handleWriteStdin} disabled={!isAgentRunning} style={{ padding: "8px 16px" }}>
                  发送 (Send)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: System Settings */}
        {activeTab === "settings" && (
          <div className="chat-window">
            <div className="dashboard-header">
              <h2 className="dashboard-title">⚙️ 系统设置与大模型中心</h2>
              <p className="dashboard-subtitle">管理本地关系型数据库配置，并调度本地 ONNX 向量化感知神经模块。</p>
            </div>

            <div className="panel">
              <div className="settings-grid" style={{ marginBottom: "20px" }}>
                
                {/* Left card: Model Settings */}
                <div className="card">
                  <h3 className="card-title">大模型中心 (LLM Hub)</h3>
                  
                  <div className="form-group">
                    <label className="form-label">模型供应商 (Model Provider)</label>
                    <select
                      className="form-input"
                      value={modelProvider}
                      onChange={(e) => setModelProvider(e.target.value)}
                      style={{ background: "#0a0b10", border: "1px solid var(--cyber-border)" }}
                    >
                      <option value="DeepSeek">DeepSeek (V3/Coder)</option>
                      <option value="Claude">Anthropic Claude</option>
                      <option value="Gemini">Google Gemini</option>
                      <option value="Ollama">Ollama (本地 Qwen)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">API 访问密钥 (API Access Key)</label>
                    <input
                      className="form-input"
                      type="password"
                      placeholder="存储于 SQLite 数据隐私安全保护内..."
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">本地系统代理 (HTTP/HTTPS Proxy)</label>
                    <input
                      className="form-input"
                      value={proxyUrl}
                      onChange={(e) => setProxyUrl(e.target.value)}
                    />
                  </div>
                </div>

                {/* Right card: Cognitive Vector Network */}
                <div className="card">
                  <h3 className="card-title">本地嵌入向量神经模型 (ONNX Network)</h3>
                  
                  <div className="form-group">
                    <label className="form-label">正在活跃的向量化引擎 (Active Model)</label>
                    <input
                      className="form-input"
                      value={onnxStatus}
                      disabled
                      style={{ color: "#00ff66", border: "1px solid rgba(0,255,102,0.2)" }}
                    />
                  </div>

                  <div style={{ marginTop: "16px", fontSize: "0.85rem", color: "var(--text-dim)", lineHeight: "1.6" }}>
                    <p>💡 <b>中文语义特化</b>：默认搭载 117MB 轻量级 <code>paraphrase-multilingual-MiniLM-L12-v2</code> 感知模型，提供 100% 本地向量提取能力。可在开机冷启动时静默下载载入。</p>
                    <p>💾 <b>磁盘健康度整理</b>：向量 LanceDB 存储配额设置为 <code>2.00 GB</code>。当磁盘配额超出阈值时，Daemon 将在夜间静默淘汰旧内存向量 (LRU 淘汰)。</p>
                  </div>
                </div>

                {/* Third card: Remote Access Settings */}
                <div className="card" style={{ gridColumn: "span 2", display: "flex", flexDirection: "column", gap: "16px" }}>
                  <h3 className="card-title">🌐 远程访问与守护进程安全 (Remote Access & Security)</h3>
                  
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", userSelect: "none" }}>
                        <input
                          type="checkbox"
                          checked={allowExternal}
                          onChange={(e) => setAllowExternal(e.target.checked)}
                          style={{
                            width: "18px",
                            height: "18px",
                            accentColor: "var(--cyber-secondary)",
                            cursor: "pointer"
                          }}
                        />
                        允许外部网络访问 (Allow External Access)
                      </label>
                      <span style={{ fontSize: "0.85rem", color: "var(--text-dim)", marginTop: "8px", lineHeight: "1.5" }}>
                        启用后，允许局域网或公网设备通过本机的 <code>0.0.0.0:17790</code> 访问后台守护进程 API。请务必配置密码以防未授权操控。
                      </span>
                      {allowExternal && (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--cyber-accent)", fontSize: "0.85rem", fontWeight: "600", marginTop: "8px" }}>
                          <span>⚠️</span>
                          <span>修改此绑定配置需要重新启动应用程序才能生效绑定。</span>
                        </div>
                      )}
                    </div>

                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">访问验证密码 (Access Password)</label>
                      <input
                        className="form-input"
                        type="password"
                        placeholder="留空表示不需要密码（强烈不推荐）..."
                        value={accessPassword}
                        onChange={(e) => setAccessPassword(e.target.value)}
                        style={{ background: "#0a0b10", border: "1px solid var(--cyber-border)" }}
                      />
                      <span style={{ fontSize: "0.85rem", color: "var(--text-dim)", marginTop: "8px", lineHeight: "1.5" }}>
                        配置密码后，任何远程设备访问 Axum Daemon 端点都必须提供相同的验证密码（支持 Bearer Token 或 X-Aide-Password）。密码保存后立即生效。
                      </span>
                    </div>
                  </div>
                </div>

              </div>

              {settingsStatus && (
                <div style={{ padding: "8px 12px", borderRadius: "6px", background: "rgba(255,255,255,0.05)", fontSize: "0.85rem", marginBottom: "16px", color: "#00ff66" }}>
                  {settingsStatus}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="btn" onClick={handleSaveSettings}>
                  💾 保存配置 (Save Config)
                </button>
              </div>

            </div>
          </div>
        )}

      </main>

      {/* 4. Premium Glassmorphic Web Connection Login Modal */}
      {isWebMode && showWebAuthModal && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          background: "rgba(3, 4, 8, 0.85)",
          backdropFilter: "blur(20px)",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Outfit', sans-serif"
        }}>
          <div className="card" style={{
            width: "480px",
            background: "rgba(13, 16, 28, 0.75)",
            border: "1px solid var(--cyber-border-active)",
            borderRadius: "16px",
            boxShadow: "0 0 40px rgba(88, 51, 255, 0.25)",
            padding: "32px",
            display: "flex",
            flexDirection: "column",
            gap: "20px"
          }}>
            <div style={{ textAlign: "center" }}>
              <div style={{
                display: "inline-flex",
                width: "56px",
                height: "56px",
                background: "linear-gradient(135deg, var(--cyber-primary), var(--cyber-secondary))",
                borderRadius: "14px",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.8rem",
                color: "white",
                boxShadow: "0 0 20px rgba(88, 51, 255, 0.4)",
                marginBottom: "16px"
              }}>
                A
              </div>
              <h2 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0, color: "#fff" }}>连接到 Aide 宿主后台</h2>
              <p style={{ fontSize: "0.85rem", color: "var(--text-dim)", marginTop: "6px" }}>
                通过外部网络访问 Aide 后端守护进程服务，请输入连接凭证。
              </p>
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">宿主机地址 (Daemon Host Address)</label>
              <input
                className="form-input"
                type="text"
                placeholder="例如 192.168.110.10:17790"
                value={webHostInput}
                onChange={(e) => setWebHostInput(e.target.value)}
                style={{ background: "rgba(0, 0, 0, 0.4)", border: "1px solid var(--cyber-border)" }}
              />
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">访问验证密码 (Access Password)</label>
              <input
                className="form-input"
                type="password"
                placeholder="请输入全局配置中的验证密码..."
                value={webPasswordInput}
                onChange={(e) => setWebPasswordInput(e.target.value)}
                style={{ background: "rgba(0, 0, 0, 0.4)", border: "1px solid var(--cyber-border)" }}
              />
            </div>

            {webAuthError && (
              <div style={{
                padding: "10px 14px",
                background: "rgba(255, 0, 127, 0.08)",
                border: "1px solid rgba(255, 0, 127, 0.2)",
                borderRadius: "8px",
                color: "var(--cyber-accent)",
                fontSize: "0.8rem",
                lineHeight: "1.4"
              }}>
                ⚠️ {webAuthError}
              </div>
            )}

            <button
              className="btn"
              onClick={() => verifyWebCredentials(webHostInput, webPasswordInput)}
              style={{ width: "100%", height: "46px", borderRadius: "10px", marginTop: "8px" }}
            >
              🔒 验证连接并登入 (Connect & Verify)
            </button>
          </div>
        </div>
      )}

      {/* 5. Premium Glassmorphic Web Directory Explorer Modal */}
      {isWebMode && showDirExplorer && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          background: "rgba(3, 4, 8, 0.8)",
          backdropFilter: "blur(16px)",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Outfit', sans-serif"
        }}>
          <div className="card" style={{
            width: "560px",
            background: "rgba(13, 16, 28, 0.85)",
            border: "1px solid var(--cyber-border-active)",
            borderRadius: "16px",
            boxShadow: "0 0 40px rgba(88, 51, 255, 0.25)",
            padding: "24px",
            display: "flex",
            flexDirection: "column",
            gap: "16px"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0, color: "#fff", display: "flex", alignItems: "center", gap: "8px" }}>
                <span>📂</span> 浏览宿主机工作区目录
              </h3>
              <button 
                onClick={() => setShowDirExplorer(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-dim)",
                  fontSize: "1.2rem",
                  cursor: "pointer"
                }}
              >
                ✕
              </button>
            </div>

            {explorerError && (
              <div style={{
                padding: "10px 14px",
                background: "rgba(255, 0, 127, 0.08)",
                border: "1px solid rgba(255, 0, 127, 0.2)",
                borderRadius: "8px",
                color: "var(--cyber-accent)",
                fontSize: "0.8rem"
              }}>
                ⚠️ {explorerError}
              </div>
            )}

            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ color: "var(--text-dim)", fontSize: "0.8rem", marginBottom: "4px" }}>当前绝对路径 (Current Path)</label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  className="form-input"
                  type="text"
                  value={explorerCurrentPath}
                  onChange={(e) => setExplorerCurrentPath(e.target.value)}
                  style={{ background: "rgba(0, 0, 0, 0.4)", border: "1px solid var(--cyber-border)", flex: 1, padding: "8px 12px" }}
                />
                <button
                  className="btn"
                  onClick={() => navigateDir(explorerCurrentPath)}
                  style={{ padding: "0 16px", borderRadius: "8px", height: "38px" }}
                >
                  前往
                </button>
              </div>
            </div>

            <div style={{
              background: "rgba(0, 0, 0, 0.3)",
              border: "1px solid var(--cyber-border)",
              borderRadius: "8px",
              padding: "8px",
              display: "flex",
              flexDirection: "column",
              gap: "4px"
            }}>
              <div style={{
                color: "var(--text-dim)",
                fontSize: "0.75rem",
                padding: "2px 8px",
                borderBottom: "1px solid rgba(255, 255, 255, 0.05)"
              }}>
                子文件夹列表
              </div>

              <div style={{
                maxHeight: "240px",
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                paddingTop: "4px"
              }}>
                {explorerParentPath && (
                  <div
                    onClick={() => navigateDir(explorerParentPath)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "6px",
                      background: "rgba(255, 255, 255, 0.03)",
                      color: "var(--cyber-primary)",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      transition: "all 0.2s"
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255, 255, 255, 0.03)"}
                  >
                    <span>⬅️</span> <span>.. (返回上一级目录)</span>
                  </div>
                )}

                {explorerSubdirs.length === 0 ? (
                  <div style={{
                    padding: "24px",
                    textAlign: "center",
                    color: "var(--text-dim)",
                    fontSize: "0.85rem"
                  }}>
                    没有文件夹或无访问权限
                  </div>
                ) : (
                  explorerSubdirs.map((name) => {
                    const target = explorerCurrentPath.endsWith("/") || explorerCurrentPath.endsWith("\\") 
                      ? `${explorerCurrentPath}${name}`
                      : `${explorerCurrentPath}/${name}`;
                    return (
                      <div
                        key={name}
                        onClick={() => navigateDir(target)}
                        style={{
                          padding: "8px 12px",
                          borderRadius: "6px",
                          background: "rgba(255, 255, 255, 0.02)",
                          color: "#eee",
                          cursor: "pointer",
                          fontSize: "0.85rem",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          transition: "all 0.2s"
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)"}
                        onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255, 255, 255, 0.02)"}
                      >
                        <span>📁</span> <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "8px" }}>
              <button
                className="btn"
                onClick={() => setShowDirExplorer(false)}
                style={{
                  background: "transparent",
                  border: "1px solid var(--cyber-border)",
                  color: "var(--text-dim)",
                  padding: "0 16px",
                  borderRadius: "8px",
                  height: "38px"
                }}
              >
                取消
              </button>
              <button
                className="btn"
                onClick={() => selectExplorerDir(explorerCurrentPath)}
                style={{
                  background: "linear-gradient(135deg, var(--cyber-primary), var(--cyber-secondary))",
                  border: "none",
                  color: "white",
                  padding: "0 20px",
                  borderRadius: "8px",
                  height: "38px",
                  fontWeight: 600,
                  boxShadow: "0 0 15px rgba(88, 51, 255, 0.3)"
                }}
              >
                确认选择当前路径
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
