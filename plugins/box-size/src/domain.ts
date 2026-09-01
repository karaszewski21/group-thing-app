export interface BoxDimensions {
  length: number;
  width: number;
  height: number;
}

export function toBoxDimensions(data: Record<string, unknown> | null): BoxDimensions | null {
  if (!data || data.length == null || data.width == null || data.height == null) return null;
  return {
    length: data.length as number,
    width: data.width as number,
    height: data.height as number,
  };
}

export function formatBox(box: BoxDimensions): string {
  return `Box: ${box.length}cm/${box.width}cm/${box.height}cm`;
}
