# Windows Gemini Detection 修复实施指南

这是一份供 AI 辅助编程工具参考的详细实施指南。之前的代码修改只完成了部分内容（超时时间已改），以下是**剩余需要彻底修复的具体步骤和精确代码要求**。

## 目标
彻底解决 Windows 环境下 `cmd.exe` 处理含空格路径时自动加引号导致截断的 Bug，并统一 Tauri 后端所有的进程启动逻辑。同时增加前端友好的错误提示。

---

## 任务 1：统一并修复后端的 `Command` 构建逻辑

当前 `src-tauri/src/lib.rs`、`src-tauri/src/daemon.rs`、`src-tauri/src/supervisor.rs` 中散落着对 `Command::new("cmd")` 的错误调用。为了保持一致性和可维护性，需要创建一个公共的方法来生成跨平台的 `Command`。

### 1.1 在 `src-tauri/src/lib.rs` 中实现 `build_agent_command`
在 `src-tauri/src/lib.rs` 的顶部或者其他帮助函数的附近，添加以下函数：

```rust
use tokio::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// 创建跨平台的 tokio::process::Command
/// 在 Windows 下使用 raw_arg 解决路径包含空格时 cmd.exe 的引号截断问题
pub fn build_agent_command(exec_path: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("cmd");
        // 注意：这里必须使用 raw_arg，不能使用 cmd.arg()，否则 Rust 会在带空格的路径外侧再次加引号
        // 我们需要传递形如: /c "C:\My Path\gemini.cmd"
        cmd.raw_arg(format!("/c \"{}\"", exec_path));
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new(exec_path)
    }
}
```

### 1.2 替换 `src-tauri/src/lib.rs` 中的调用
在 `lib.rs` 的 `test_agent_availability` 函数中：

**删除以下旧代码：**
```rust
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;

    // Build command with correct argument handling for Windows cmd.exe
    // On Windows: use raw_arg to bypass Rust's automatic quoting,
    // which causes cmd.exe /c "path with spaces" to strip quotes incorrectly.
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = tokio::process::Command::new("cmd");
        c.arg(format!("/c {}", exec_path));
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = tokio::process::Command::new(&exec_path);
```

**替换为：**
```rust
    let mut cmd = crate::build_agent_command(&exec_path);
```

### 1.3 替换 `src-tauri/src/daemon.rs` 中的调用
在 `daemon.rs` 中搜索 `Command::new("cmd")`，并将其替换。

**目标函数：`run_subagent` (大约在 L470-L495)**
**删除旧代码：**
```rust
            let mut cmd_proc = if cfg!(target_os = "windows") {
                let mut c = tokio::process::Command::new("cmd");
                c.args(&["/c", &command]);
                c
            } else {
                tokio::process::Command::new(&command)
            };
```
**替换为：**
```rust
            let mut cmd_proc = crate::build_agent_command(&command);
```

**目标函数：`run_acp_terminal` (大约在 L587-L620)**
**删除旧代码：**
```rust
            let mut cmd_proc = if cfg!(target_os = "windows") {
                let mut c = tokio::process::Command::new("cmd");
                c.args(&["/c", &exec_path]);
                c
            } else {
                tokio::process::Command::new(&exec_path)
            };
```
**替换为：**
```rust
            let mut cmd_proc = crate::build_agent_command(&exec_path);
```

### 1.4 替换 `src-tauri/src/supervisor.rs` 中的调用
在 `supervisor.rs` 中搜索 `Command::new("cmd")`。

**目标函数：`spawn_agent_process` (大约在 L76-L81)**
**删除旧代码：**
```rust
        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = Command::new("cmd");
            c.args(&["/c", exec_path]);
            c
        } else {
            Command::new(exec_path)
        };
```
**替换为：**
```rust
        let mut cmd = crate::build_agent_command(exec_path);
```
*(注意：在 `supervisor.rs` 中可能需要导入 `tokio::process::Command` 或者调整函数的返回/调用。)*

---

## 任务 2：完善前端 `App.tsx` 中的异常提示

在 `src/App.tsx` 中的 `handleTestAgent` 函数（约 1584 行）中，当前只有简单的错误输出。我们需要增加针对 Windows 环境的友好提示。

**目标代码区域：**
```typescript
    } catch (e: any) {
      setTestStatus("failed");
      setTestOutput(e.toString());
    }
```

**修改为：**
```typescript
    } catch (e: any) {
      setTestStatus("failed");
      let errorMsg = e.toString();
      
      // 检查当前操作系统环境
      if (navigator.userAgent.indexOf("Windows") !== -1) {
          errorMsg += "\n\n💡 [Windows 环境提示]:";
          errorMsg += "\n1. 若您刚安装 CLI，请确保 npm/python 全局目录已加入系统 PATH，并重启此应用。";
          errorMsg += "\n2. 请尝试输入完整的绝对路径，并务必加上后缀，例如: C:\\Users\\Name\\AppData\\Roaming\\npm\\gemini.cmd";
      }
      
      setTestOutput(errorMsg);
    }
```

## 注意事项

1. **Rust 编译：** 替换完毕后，建议运行 `cargo check` 确保跨平台逻辑正确。
2. **正确使用 raw_arg：** 核心修复在于 `cmd.raw_arg(format!("/c \"{}\"", exec_path));` 这句话，千万不可回退到使用 `args()` 传递。