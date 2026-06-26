import { useState } from "react";
import { AutoResizeTextarea } from "../ui/AutoResizeTextarea/AutoResizeTextarea";
import { PlusButton } from "../IconsButton/PlusButton";
import { ButtonPromptBar } from "./ButtonPromptBar";

export function PromptBar() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  return (
    <div className="w-full max-w-2xl bg-[var(--bg-prompt-bar)] rounded-3xl p-2.5 flex items-center justify-center my-0 mx-auto">
      <ButtonPromptBar onClick={() => setOpen((v) => !v)}>
        <PlusButton />
      </ButtonPromptBar>
      <AutoResizeTextarea
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
      />
    </div>
  );
}
