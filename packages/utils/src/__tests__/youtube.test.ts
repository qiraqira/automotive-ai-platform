import { describe, expect, it } from "vitest";
import { extractYoutubeId } from "../youtube.js";

describe("extractYoutubeId", () => {
  it("extracts from the standard watch URL", () => {
    expect(extractYoutubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts from a watch URL with extra tracking params after v=", () => {
    expect(extractYoutubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL123")).toBe("dQw4w9WgXcQ");
  });

  it("extracts from the short youtu.be link", () => {
    expect(extractYoutubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts from a youtu.be link with a trailing query string", () => {
    expect(extractYoutubeId("https://youtu.be/dQw4w9WgXcQ?t=10")).toBe("dQw4w9WgXcQ");
  });

  it("extracts from an /embed/ URL", () => {
    expect(extractYoutubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts from a /shorts/ URL", () => {
    expect(extractYoutubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("works without the www. prefix", () => {
    expect(extractYoutubeId("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("returns null for a non-YouTube URL", () => {
    expect(extractYoutubeId("https://vimeo.com/12345678")).toBeNull();
  });

  it("returns null for a YouTube URL with no video ID (e.g. the bare homepage)", () => {
    expect(extractYoutubeId("https://www.youtube.com/")).toBeNull();
  });

  it("returns null for a malformed URL", () => {
    expect(extractYoutubeId("not a url")).toBeNull();
  });

  it("returns null when the id-shaped value is the wrong length", () => {
    expect(extractYoutubeId("https://www.youtube.com/watch?v=short")).toBeNull();
  });
});
