export function WorkbenchShell({
  projectId,
  sessionId,
}: {
  projectId: string;
  sessionId: string;
}): React.JSX.Element {
  return (
    <main className="workbench-shell" data-project-id={projectId} data-session-id={sessionId}>
      <header>
        <div>
          <p className="context-label">访谈工作台</p>
          <h1>访谈已开始</h1>
        </div>
        <span className="live-indicator">录音会话已启动</span>
      </header>
      <section aria-labelledby="workbench-placeholder-title">
        <h2 id="workbench-placeholder-title">正在进入实时访谈</h2>
        <p>正式工作台将在 DEV-005B 接入。当前页面不提供结束、完成模拟或 AI 建议。</p>
      </section>
    </main>
  );
}
