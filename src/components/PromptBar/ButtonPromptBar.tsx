import type { PropsWithChildren } from "react";

interface ButtonPromptBarProps extends PropsWithChildren {
  onClick: () => void;
}

export function ButtonPromptBar({ children, ...props }: ButtonPromptBarProps) {
  return (
    <button
      className="p-2 hover:bg-[var(--icon-btn-hover)] rounded-full items-center cursor-pointer"
      {...props}
    >
      {children}
    </button>
  );
}
