import type { PropsWithChildren } from "react";

interface IconButtonProps extends PropsWithChildren {}

export function IconButton({ children, ...props }: IconButtonProps) {
  return (
    <button
      className="p-2 hover:bg-[var(--icon-btn-hover)] rounded-full items-center cursor-pointer"
      {...props}
    >
      {children}
    </button>
  );
}
