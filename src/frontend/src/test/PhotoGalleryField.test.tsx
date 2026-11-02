import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PhotoGalleryField, type GalleryPhoto } from "../components/shared/PhotoGalleryField";

function photos(n: number): GalleryPhoto[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, src: `https://cdn.example/p${i + 1}.webp` }));
}

describe("PhotoGalleryField", () => {
  it("hands picked files and removals back to the caller", () => {
    const onFiles = vi.fn();
    const onRemove = vi.fn();
    render(<PhotoGalleryField photos={photos(2)} max={10} disabled={false} onFiles={onFiles} onRemove={onRemove} />);

    const file = new File(["a"], "a.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Dodaj zdjęcia"), { target: { files: [file] } });
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Następne zdjęcie" }));
    fireEvent.click(screen.getByRole("button", { name: "Usuń zdjęcie 2" }));

    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(onRemove).toHaveBeenCalledWith("p2");
    expect(screen.queryByRole("button", { name: /^Przesuń/ })).not.toBeInTheDocument();
  });

  it("while empty: the slider with its corner add button by default, one large + tile in the create variant", () => {
    const props = { photos: [], max: 10, disabled: false, onFiles: vi.fn(), onRemove: vi.fn() };
    const { rerender } = render(<PhotoGalleryField {...props} />);
    expect(screen.getByText("+ Dodaj zdjęcia")).toBeInTheDocument();

    rerender(<PhotoGalleryField {...props} variant="create" />);
    expect(screen.queryByText("+ Dodaj zdjęcia")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Dodaj zdjęcia")).toBeEnabled();
  });

  it("replaces the add button with the limit note once full", () => {
    render(<PhotoGalleryField photos={photos(3)} max={3} disabled={false} onFiles={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.queryByLabelText("Dodaj zdjęcia")).not.toBeInTheDocument();
    expect(screen.getByText("Osiągnięto limit 3 zdjęć")).toBeInTheDocument();
  });

  it("a single banner has an unnumbered Usuń and no add button or limit note while set", () => {
    const onRemove = vi.fn();
    const { rerender } = render(
      <PhotoGalleryField
        photos={[]}
        max={1}
        disabled={false}
        onFiles={vi.fn()}
        onRemove={onRemove}
        noun="baner"
        addLabel="Dodaj baner"
      />,
    );
    expect(screen.getByLabelText("Dodaj baner")).not.toHaveAttribute("multiple");

    rerender(
      <PhotoGalleryField
        photos={photos(1)}
        max={1}
        disabled={false}
        onFiles={vi.fn()}
        onRemove={onRemove}
        noun="baner"
        addLabel="Dodaj baner"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Usuń baner" }));

    expect(onRemove).toHaveBeenCalledWith("p1");
    expect(screen.queryByLabelText("Dodaj baner")).not.toBeInTheDocument();
    expect(screen.queryByText(/Osiągnięto limit/)).not.toBeInTheDocument();
  });
});
