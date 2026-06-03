# Gemini CLI Windows 检测失败分析与优化方案

## 1. 现象与问题分析

当前在 Ubuntu/Linux 环境下能正常检测到 `gemini` CLI，但在 Windows 环境下 `test_agent_availability` 或实际执行时会失败。核心原因可归结为以下几点：

### 1.1 `cmd.exe` 引号截断 Bug（核心执行问题）
Tauri 后端（`src-tauri/src/lib.rs`、`daemon.rs` 等）处理 Windows 进程启动时的代码如下：
```rust
let mut c = tokio::process::Command::new("cmd");
c.args(&["/c", &exec_path]);
```
由于 Rust 的 `std::process::Command` 在 Windows 下会自动为包含空格的参数添加双引号，当用户输入带空格的绝对路径（例如 `C:\Program Files\nodejs\npm\gemini.cmd`），生成的命令为 `cmd.exe /c "C:\...\gemini.cmd" --version`。
Windows `cmd.exe` 在执行 `/c` 时，若发现首尾都有引号，会**强行剥离最外层的引号**，导致命令变成 `C:\...\gemini.cmd" --version`（内部截断），从而引发语法错误，提示路径无法识别。

### 1.2 环境变量 (PATH) 继承问题
在 Windows 下，GUI 桌面应用（如 Tauri 编译出的客户端）是从 `explorer.exe` 继承环境变量的。如果用户使用 NVM 安装 Node，或近期通过终端刚执行了 `npm install -g @google/gemini-cli`，没有重启系统或资源管理器，Tauri 进程内读取到的 `PATH` 很可能是旧的，导致直接调用 `cmd /c gemini` 找不到该命令。

### 1.3 Node.js 启动延迟与硬编码超时
可用性测试代码中存在硬编码超时：`timeout(Duration::from_secs(3), test_run)`。
在 Windows 环境下，通过 `cmd.exe` 启动 `.cmd` 批处理，再拉起 `node.exe` 执行 CLI 工具，整个过程经常受到 Windows Defender 的扫描影响，耗时极易超过 3 秒，从而直接返回超时错误（“执行超时: 智能体在 3 秒内未响应”）。

### 1.4 `.cmd` 扩展名解析差异
当用户因找不到 `gemini` 而尝试手动输入绝对路径，但漏掉 `.cmd` 后缀时（指向了 npm 生成的无后缀 bash 脚本），`cmd.exe` 将无法将其作为可执行文件运行。

---

## 2. 优化与修改建议

为了彻底解决此跨平台问题，建议进行以下优化：

### 2.1 增加可用性测试的超时时间
* **目标**：`src-tauri/src/lib.rs` 中的 `test_agent_availability` 函数。
* **建议**：将 3 秒超时 `Duration::from_secs(3)` 增加至 **8-10 秒**，以容忍 Windows 下 Node.js 和 `cmd.exe` 的冷启动延迟。

### 2.2 修复 Windows 下的 `cmd.exe` 调用及传参方式
* **目标**：重构 `lib.rs`、`daemon.rs`、`supervisor.rs` 中涉及 `Command::new("cmd")` 的创建逻辑。
* **建议**：避免使用容易出错的多次 `args()` 拼接。可以提取一个跨平台的 `build_agent_command` 函数，在 Windows 下优先使用 `std::os::windows::process::CommandExt` 的 `raw_arg()`，或者显式指定 `cmd.exe /S /C "命令"`，利用 `/S` 参数要求 cmd.exe 保留内部双引号。

### 2.3 友好的路径提示
* **目标**：前端 `App.tsx` 的测试失败反馈逻辑。
* **建议**：在捕获到测试失败异常且为 Windows 环境时，在控制台输出中额外增加提示：“Windows 用户请确保 npm 全局目录已加入系统 PATH，并重启应用；或尝试输入完整路径如 C:\Users\Name\AppData\Roaming\npm\gemini.cmd”。

---

## 3. 实施步骤与存放计划

为了符合您提出的**“修改计划写进 .md 文件，放在当前工程下的专门目录”**的需求：

1. **归档文档**：在项目根目录（`/home/kylin/workspace/Aide`）创建一个 `docs/plans`（或 `docs/design`）文件夹，将本方案以 `windows-gemini-detection.md` 的名称存入该目录，用作后续知识库和架构记录。
2. **执行代码修改**：
   - 提取全局的 `build_process` 函数以规范化命令创建。
   - 更改 `test_agent_availability` 的 timeout 参数。
3. **验证**：在前端触发 `gemini` (带有和不带 `.cmd` 后缀的绝对路径) 测试，确保状态码与解析正确。