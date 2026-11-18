import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

/**
 * shadcn/ui's Native Select: the platform <select>, styled to match the other
 * inputs. (The Radix-based Select would need a dependency this package does not
 * have; the native one is the right size for picking a chain out of a few.)
 */
export function NativeSelect({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative w-fit has-[select:disabled]:opacity-50">
      <select
        className={cn(
          "border-input bg-background focus-visible:ring-ring h-9 w-full min-w-0 appearance-none rounded-md border py-2 pr-9 pl-3 font-mono text-sm outline-none focus-visible:ring-1 disabled:pointer-events-none",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 opacity-60 select-none"
      />
    </div>
  );
}
