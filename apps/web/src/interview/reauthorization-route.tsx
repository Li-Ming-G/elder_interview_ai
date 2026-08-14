import { HomeFrame } from '../home/home-shell.js';

export function ReauthorizationRoute({
  navigate,
}: {
  navigate: (path: string) => void;
}): React.JSX.Element {
  return (
    <HomeFrame>
      <section className="route-shell" aria-labelledby="reauthorization-title">
        <p className="context-label">正式授权</p>
        <h1 id="reauthorization-title">当前无法重新登记正式授权</h1>
        <p role="status">
          服务端尚未提供已审查的正式授权正文与适用范围，系统已停止在此处，且不会创建授权记录或授权录音。
        </p>
        <button
          className="button button--secondary"
          onClick={() => {
            navigate('/');
          }}
          type="button"
        >
          返回工作区
        </button>
      </section>
    </HomeFrame>
  );
}
