import { useEffect } from "react";

/** 未保存表单离开提醒：仅在存在未保存修改时注册 beforeunload，卸载或保存后自动移除。 */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // 现代浏览器会忽略自定义文案，但设置 returnValue 是触发标准离开提示的兼容要求。
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}
