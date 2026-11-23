// 线性图标集：全部为 24×24 描边 SVG，统一 1.6 线宽，不使用 emoji 或位图。

const wrap = (body, size = 24) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
    stroke-linecap="round" stroke-linejoin="round" width="${size}" height="${size}"
    aria-hidden="true" focusable="false">${body}</svg>`;

export const icons = {
  check: () => wrap('<path d="M4.5 12.6l4.6 4.6L19.5 6.8"/>', 20),
  checkCircle: () => wrap('<circle cx="12" cy="12" r="8.2"/><path d="M8.6 12.2l2.4 2.4 4.4-4.8"/>'),
  today: () => wrap('<rect x="3.6" y="5.4" width="16.8" height="15" rx="3.4"/><path d="M3.6 10h16.8M8.4 3.4v3.4M15.6 3.4v3.4"/><path d="M9.2 14.6l1.9 1.9 3.7-4"/>'),
  records: () => wrap('<path d="M5 4.6h14M5 10.2h14M5 15.8h9.5M5 21" opacity="0"/>' +
    '<path d="M6.4 3.8h11.2a1.8 1.8 0 0 1 1.8 1.8v12.8a1.8 1.8 0 0 1-1.8 1.8H6.4a1.8 1.8 0 0 1-1.8-1.8V5.6a1.8 1.8 0 0 1 1.8-1.8z"/><path d="M8.6 8.6h6.8M8.6 12.4h6.8M8.6 16.2h4.2"/>'),
  account: () => wrap('<circle cx="12" cy="8.4" r="3.6"/><path d="M4.8 20.2c.9-3.6 3.7-5.6 7.2-5.6s6.3 2 7.2 5.6"/>'),
  settings: () => wrap('<path d="M4 7.4h7M15.4 7.4H20M4 16.6h4.6M13 16.6H20"/><circle cx="13" cy="7.4" r="2.4"/><circle cx="10.6" cy="16.6" r="2.4"/>'),
  clock: () => wrap('<circle cx="12" cy="12" r="8.2"/><path d="M12 7.6V12l3.1 1.9"/>'),
  plus: () => wrap('<path d="M12 5.2v13.6M5.2 12h13.6"/>', 20),
  chevronLeft: () => wrap('<path d="M14.4 5.6L8 12l6.4 6.4"/>', 18),
  chevronRight: () => wrap('<path d="M9.6 5.6L16 12l-6.4 6.4"/>', 18),
  chevronDown: () => wrap('<path d="M6 9.4l6 6 6-6"/>', 16),
  arrowRight: () => wrap('<path d="M4.6 12h14.2M13.4 6.6L18.8 12l-5.4 5.4"/>', 18),
  shield: () => wrap('<path d="M12 3.4l7 2.6v5.6c0 4.2-2.9 7.4-7 8.9-4.1-1.5-7-4.7-7-8.9V6z"/><path d="M9 12.2l2.2 2.2 4-4.4"/>'),
  link: () => wrap('<path d="M10.2 13.8a3.4 3.4 0 0 0 4.8 0l2.6-2.6a3.4 3.4 0 0 0-4.8-4.8l-1.2 1.2"/><path d="M13.8 10.2a3.4 3.4 0 0 0-4.8 0l-2.6 2.6a3.4 3.4 0 1 0 4.8 4.8l1.2-1.2"/>'),
  sun: () => wrap('<circle cx="12" cy="12" r="4"/><path d="M12 3.2v2.2M12 18.6v2.2M3.2 12h2.2M18.6 12h2.2M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M18.2 5.8l-1.6 1.6M7.4 16.6l-1.6 1.6"/>', 20),
  moon: () => wrap('<path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2z"/>', 20),
  auto: () => wrap('<circle cx="12" cy="12" r="3"/><path d="M12 3.4v2.4M12 18.2v2.4M3.4 12h2.4M18.2 12h2.4M6.2 6.2l1.7 1.7M16.1 16.1l1.7 1.7M17.8 6.2l-1.7 1.7M7.9 16.1l-1.7 1.7"/>', 20),
  info: () => wrap('<circle cx="12" cy="12" r="8.2"/><path d="M12 11v5.2M12 7.9h.01"/>', 20),
  close: () => wrap('<path d="M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6"/>', 18),
  refresh: () => wrap('<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19.4 5.4v4.2h-4.2"/>', 20),
  trash: () => wrap('<path d="M4.6 6.8h14.8M9.4 6.8V4.9h5.2v1.9M6.6 6.8l.9 12.1a1.8 1.8 0 0 0 1.8 1.7h5.4a1.8 1.8 0 0 0 1.8-1.7l.9-12.1"/>', 20),
  swap: () => wrap('<path d="M4.4 8.2h13.2l-3-3M19.6 15.8H6.4l3 3"/>', 20),
  external: () => wrap('<path d="M13.4 4.8h5.8v5.8M19.2 4.8l-7.6 7.6"/><path d="M18 14.4v3.4a2 2 0 0 1-2 2H6.4a2 2 0 0 1-2-2V7.6a2 2 0 0 1 2-2h3.4"/>', 18),
  flag: () => wrap('<path d="M6 3.8v16.4"/><path d="M6 4.8h9.8l-1.6 3.4 1.6 3.4H6"/>', 20),
  seal: () => wrap('<circle cx="12" cy="12" r="8.4"/><path d="M8.2 12.3l2.6 2.6 5-5.6"/>', 26),
};

export default icons;
