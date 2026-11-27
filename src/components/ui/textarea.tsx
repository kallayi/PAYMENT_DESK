import * as React from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> { }

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-950 font-medium shadow-sm ring-offset-background placeholder:text-slate-500 hover:border-slate-400 focus-visible:outline-none focus-visible:border-[#7F1D1D] focus-visible:ring-2 focus-visible:ring-[#7F1D1D]/15 disabled:cursor-not-allowed disabled:opacity-50 transition-colors resize-none",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
