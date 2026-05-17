import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import BiasAlert from "../BiasAlert";

describe("BiasAlert", () => {
  it("renders nothing when no biases", () => {
    const { container } = render(<BiasAlert biases={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows anchoring bias label", () => {
    render(<BiasAlert biases={["anchoring"]} />);
    expect(screen.getByText("Anchoring")).toBeTruthy();
  });

  it("shows at most 2 biases", () => {
    render(
      <BiasAlert
        biases={["anchoring", "premature_closure", "availability"]}
      />,
    );
    // Only first 2 should be rendered
    const badges = screen.getAllByText(/Anchoring|Premature Closure|Availability/);
    expect(badges.length).toBeLessThanOrEqual(2);
  });

  it("ignores unknown bias types", () => {
    const { container } = render(<BiasAlert biases={["unknown_bias"]} />);
    expect(container.firstChild?.childNodes.length).toBe(0);
  });
});
