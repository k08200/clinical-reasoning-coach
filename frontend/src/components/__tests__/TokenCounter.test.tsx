import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import TokenCounter from "../TokenCounter";

describe("TokenCounter", () => {
  it("renders all three token types", () => {
    render(
      <TokenCounter
        usage={{ input_tokens: 1000, output_tokens: 500, thinking_tokens: 2000 }}
        thinking={false}
      />,
    );
    expect(screen.getByText(/In: 1,000/)).toBeTruthy();
    expect(screen.getByText(/Out: 500/)).toBeTruthy();
    expect(screen.getByText(/Thinking: 2,000/)).toBeTruthy();
  });

  it("shows total token count", () => {
    render(
      <TokenCounter
        usage={{ input_tokens: 100, output_tokens: 200, thinking_tokens: 300 }}
        thinking={false}
      />,
    );
    expect(screen.getByText(/600/)).toBeTruthy();
  });

  it("handles zero tokens", () => {
    render(
      <TokenCounter
        usage={{ input_tokens: 0, output_tokens: 0, thinking_tokens: 0 }}
        thinking={false}
      />,
    );
    expect(screen.getByText(/Total: 0/)).toBeTruthy();
  });
});
