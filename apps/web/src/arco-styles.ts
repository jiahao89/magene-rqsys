// 按需引入 Arco 样式：只加载工作台实际用到的组件及其依赖，替代整份 arco.css。
// 新增 Arco 组件时，必须把它的 style/css.js 加到这里，否则该组件会没有样式。
import "@arco-design/web-react/es/style/index.css"; // 基础 token（含 body[arco-theme='dark'] 变量）
import "@arco-design/web-react/es/Breadcrumb/style/css.js";
import "@arco-design/web-react/es/Button/style/css.js";
import "@arco-design/web-react/es/Card/style/css.js";
import "@arco-design/web-react/es/Collapse/style/css.js";
import "@arco-design/web-react/es/Input/style/css.js";
import "@arco-design/web-react/es/Menu/style/css.js";
import "@arco-design/web-react/es/Modal/style/css.js";
import "@arco-design/web-react/es/Select/style/css.js";
import "@arco-design/web-react/es/Table/style/css.js";
import "@arco-design/web-react/es/Tag/style/css.js";
