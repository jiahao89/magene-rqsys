import { Button as ArcoButton, Card as ArcoCard, Input as ArcoInput, Tag } from "@arco-design/web-react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";

/** HeroUI 语义到 Arco 的映射层：保留旧调用方 props，内部统一渲染 Arco 组件。 */
type Variant = "primary" | "secondary" | "danger" | "default" | "ghost";
type InputEventLike = { target: { value: string } };

export function Button(props: {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  variant?: Variant;
  onPress?: () => void;
  isDisabled?: boolean;
  slot?: string;
  tabIndex?: number;
  type?: "button" | "submit" | "reset";
  title?: string;
  "aria-label"?: string;
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
}) {
  const { variant = "default", onPress, isDisabled, slot: _slot, type = "button", className, ...rest } = props;
  // 旧工作台把视觉样式写在 button/button-* 类上；Arco 按钮应使用自身视觉，只保留布局类。
  const legacy = new Set(["button", "button-primary", "button-secondary", "button-small", "button-danger"]);
  const classes = (className ?? "").split(/\s+/).filter(Boolean);
  const kept = classes.filter((token) => !legacy.has(token));
  const primary = variant === "primary" || classes.includes("button-primary");
  const secondary = variant === "secondary" || classes.includes("button-secondary");
  const danger = variant === "danger" || classes.includes("button-danger");
  const small = classes.includes("button-small");
  const arcoType = primary ? "primary" : secondary ? "secondary" : "default";
  return <ArcoButton type={arcoType} status={danger ? "danger" : undefined} size={small ? "small" : undefined} disabled={isDisabled} onClick={onPress} htmlType={type} className={kept.join(" ") || undefined} {...rest} />;
}

const CHIP_COLOR: Record<string, string> = { success: "green", warning: "orange", danger: "red", accent: "arcoblue", default: "gray" };

export function Chip(props: {
  children?: ReactNode;
  className?: string;
  color?: string;
  variant?: string;
  size?: "sm" | "md" | "lg";
  title?: string;
}) {
  const { children, className, color = "default", size, title } = props;
  return <Tag className={className} color={CHIP_COLOR[color] ?? "gray"} size={size === "sm" ? "small" : "default"} bordered={false} title={title}>{children}</Tag>;
}

export function Input(props: {
  value?: string;
  onChange?: (event: InputEventLike) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
  className?: string;
  style?: CSSProperties;
  id?: string;
  title?: string;
  "aria-label"?: string;
}) {
  const { onChange, ...rest } = props;
  return <ArcoInput {...rest} onChange={(value: string) => onChange?.({ target: { value } })} />;
}

function CardBase(props: { children?: ReactNode; className?: string; style?: CSSProperties }) {
  return <ArcoCard className={props.className} style={props.style}>{props.children}</ArcoCard>;
}
function CardContent(props: { children?: ReactNode; className?: string }) {
  return <div className={props.className}>{props.children}</div>;
}

export const Card = Object.assign(CardBase, { Content: CardContent });
