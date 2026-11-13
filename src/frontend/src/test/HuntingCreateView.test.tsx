import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HuntingCreateView } from "../features/add/HuntingCreateView";
import { renderWithRoute } from "./renderWithRoute";

describe("HuntingCreateView", () => {
  it("prefills the name from ?name=", () => {
    renderWithRoute(<HuntingCreateView />, { url: "/add/hunting?name=%20foteliki%20", pattern: "/add/hunting" });

    expect(screen.getByLabelText("Czego szukasz?")).toHaveValue("foteliki");
  });

  it("starts empty without the parameter", () => {
    renderWithRoute(<HuntingCreateView />, { url: "/add/hunting", pattern: "/add/hunting" });

    expect(screen.getByLabelText("Czego szukasz?")).toHaveValue("");
  });
});
