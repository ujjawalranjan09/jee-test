import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NumQuestionsInput } from "../components/Upload/UploadView";

describe("NumQuestionsInput", () => {
  it("renders the current value", () => {
    render(<NumQuestionsInput value={25} onChange={() => {}} />);
    const input = screen.getByRole("spinbutton", {
      name: /number of questions/i,
    }) as HTMLInputElement;
    expect(input.value).toBe("25");
  });

  it("clamps a value above max down to max", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<NumQuestionsInput value={10} onChange={onChange} max={500} defaultValue={10} />);
    const input = screen.getByRole("spinbutton", {
      name: /number of questions/i,
    });
    await user.clear(input);
    await user.type(input, "9999");
    fireEvent.blur(input);
    // The displayed text snaps to the clamped value.
    expect((input as HTMLInputElement).value).toBe("500");
    expect(onChange).toHaveBeenCalledWith(500);
  });

  it("clamps a value below min up to min", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<NumQuestionsInput value={10} onChange={onChange} min={1} defaultValue={10} />);
    const input = screen.getByRole("spinbutton", {
      name: /number of questions/i,
    });
    await user.clear(input);
    await user.type(input, "0");
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe("1");
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("falls back to defaultValue on non-numeric input", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<NumQuestionsInput value={10} onChange={onChange} defaultValue={7} />);
    const input = screen.getByRole("spinbutton", {
      name: /number of questions/i,
    });
    await user.clear(input);
    await user.type(input, "abc");
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe("7");
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("+ button increments value", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<NumQuestionsInput value={10} onChange={onChange} max={500} />);
    await user.click(screen.getByLabelText(/increase number of questions/i));
    expect(onChange).toHaveBeenCalledWith(11);
  });

  it("− button decrements value", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<NumQuestionsInput value={10} onChange={onChange} min={1} />);
    await user.click(screen.getByLabelText(/decrease number of questions/i));
    expect(onChange).toHaveBeenCalledWith(9);
  });

  it("− button is disabled at min", () => {
    render(<NumQuestionsInput value={1} onChange={() => {}} min={1} />);
    expect(
      screen.getByLabelText(/decrease number of questions/i),
    ).toBeDisabled();
  });

  it("+ button is disabled at max", () => {
    render(<NumQuestionsInput value={500} onChange={() => {}} max={500} />);
    expect(
      screen.getByLabelText(/increase number of questions/i),
    ).toBeDisabled();
  });

  it("Enter key commits the value", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<NumQuestionsInput value={10} onChange={onChange} />);
    const input = screen.getByRole("spinbutton", {
      name: /number of questions/i,
    });
    await user.clear(input);
    await user.type(input, "33{Enter}");
    expect(onChange).toHaveBeenCalledWith(33);
  });

  it("does not call onChange if clamped value equals current value", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<NumQuestionsInput value={25} onChange={onChange} max={500} />);
    const input = screen.getByRole("spinbutton", {
      name: /number of questions/i,
    });
    await user.clear(input);
    await user.type(input, "25");
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });
});