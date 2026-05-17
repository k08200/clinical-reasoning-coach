import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import ChatMessage from "../ChatMessage";
import type { Message } from "@/types";

const base: Message = {
  id: "msg-1",
  role: "student",
  content: "I think this is ACS.",
  reasoning_score: null,
  biases_detected: [],
  created_at: "2026-01-01T00:00:00Z",
};

describe("ChatMessage — student", () => {
  it("shows You avatar", () => {
    render(<ChatMessage message={base} />);
    expect(screen.getByText("You")).toBeTruthy();
  });

  it("renders content", () => {
    render(<ChatMessage message={base} />);
    expect(screen.getByText("I think this is ACS.")).toBeTruthy();
  });

  it("does not show reasoning score when null", () => {
    render(<ChatMessage message={base} />);
    expect(screen.queryByText(/Reasoning score/)).toBeNull();
  });

  it("shows reasoning score badge when score is set", () => {
    render(<ChatMessage message={{ ...base, reasoning_score: 72 }} />);
    expect(screen.getByText(/Reasoning score/)).toBeTruthy();
    expect(screen.getByText("72")).toBeTruthy();
  });
});

describe("ChatMessage — coach", () => {
  const coach: Message = { ...base, role: "coach", content: "What findings stand out?" };

  it("shows AI avatar", () => {
    render(<ChatMessage message={coach} />);
    expect(screen.getByText("AI")).toBeTruthy();
  });

  it("renders content", () => {
    render(<ChatMessage message={coach} />);
    expect(screen.getByText("What findings stand out?")).toBeTruthy();
  });

  it("never shows reasoning score badge for coach", () => {
    // Even if reasoning_score were set on a coach message, badge should not appear
    render(<ChatMessage message={{ ...coach, reasoning_score: 80 }} />);
    expect(screen.queryByText(/Reasoning score/)).toBeNull();
  });
});

describe("ChatMessage — streaming / thinking states", () => {
  it("shows thinking animation text", () => {
    render(<ChatMessage message={base} thinking />);
    expect(screen.getByText(/Analyzing your reasoning/)).toBeTruthy();
  });

  it("does not show content while thinking", () => {
    render(<ChatMessage message={base} thinking />);
    expect(screen.queryByText("I think this is ACS.")).toBeNull();
  });
});
