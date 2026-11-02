import { Modal } from "@arco-design/web-react";
import { useId, type ReactNode } from "react";

/**
 * 破坏性操作的确认弹窗。Arco `Modal` 把 role 写死为 `dialog`，屏幕阅读器不会按"警示对话框"播报；
 * 这里在弹窗打开后把 role 改成 `alertdialog`，并用 aria-describedby 关联正文。
 * 只改这一个弹窗节点：按弹窗根元素的 id 精确定位，避免误改页面上别的 Modal。
 */
export function ConfirmModal({ visible, title, description, okText, cancelText = "取消", onOk, onCancel, afterClose }: {
  visible: boolean;
  title: string;
  description: ReactNode;
  okText: string;
  cancelText?: string;
  onOk: () => void;
  onCancel: () => void;
  afterClose?: () => void;
}) {
  const bodyId = useId();
  const markAlert = () => {
    const body = document.getElementById(bodyId);
    const dialog = body?.closest<HTMLElement>(".arco-modal");
    if (!dialog) return;
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-describedby", bodyId);
  };
  return (
    <Modal visible={visible} title={title} okText={okText} cancelText={cancelText} okButtonProps={{ status: "danger" }} onOk={onOk} onCancel={onCancel} afterOpen={markAlert} afterClose={afterClose}>
      <p id={bodyId}>{description}</p>
    </Modal>
  );
}
