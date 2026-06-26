import { PromptBar } from "../components/PromptBar/PromptBar";
import "../scss/default/_index.scss";

export function HomePage() {
  return (
    <div className="flex flex-col bg-[var(--bg)] justify-center">
      <h1>Введи запрос</h1>
      <PromptBar />
    </div>
  );
}
