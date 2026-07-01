import { Check, Info, TriangleAlert, X } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";
import { cn } from "../lib/utils";

type Variant = "success" | "error" | "info";
interface Toast {
  id: number;
  title: string;
  description?: string;
  variant: Variant;
}

type Push = (t: { title: string; description?: string; variant?: Variant }) => void;

const ToastCtx = createContext<Push>(() => {});

export function useToast(): Push {
  return useContext(ToastCtx);
}

const ICON: Record<Variant, typeof Check> = {
  success: Check,
  error: TriangleAlert,
  info: Info,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const push = useCallback<Push>(
    ({ title, description, variant = "info" }) => {
      const id = nextId.current++;
      setToasts((ts) => [...ts, { id, title, description, variant }]);
      setTimeout(() => remove(id), 5000);
    },
    [remove],
  );

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => {
          const Icon = ICON[t.variant];
          return (
            <div
              key={t.id}
              className={cn(
                "toast-in bg-card pointer-events-auto flex items-start gap-3 rounded-xl border p-4 shadow-lg",
              )}
            >
              <Icon className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t.title}</p>
                {t.description && (
                  <p className="text-muted-foreground mt-0.5 text-xs break-words">
                    {t.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove(t.id)}
                className="text-muted-foreground hover:text-foreground shrink-0"
                aria-label="Dismiss"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
