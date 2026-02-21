const sidebarDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatEditorLabel(item: {
  id: string;
  createdAt: number;
  title?: string;
}) {
  const normalizedTitle = item.title?.trim();
  if (normalizedTitle) {
    return normalizedTitle;
  }

  const date = new Date(item.createdAt);
  const dateLabel = Number.isNaN(date.getTime())
    ? "Invalid date"
    : sidebarDateFormatter.format(date).replaceAll("/", "-");
  return `${dateLabel} · ${item.id.slice(-6)}`;
}
