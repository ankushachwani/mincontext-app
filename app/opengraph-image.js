import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#0d0d0d",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "80px 100px",
        }}
      >
        <div
          style={{
            color: "#5b8dd9",
            fontSize: "80px",
            fontWeight: 700,
            letterSpacing: "-4px",
            marginBottom: "28px",
            fontFamily: "monospace",
          }}
        >
          mincontext
        </div>
        <div
          style={{
            color: "#666",
            fontSize: "30px",
            lineHeight: 1.5,
            maxWidth: "820px",
            fontFamily: "monospace",
          }}
        >
          Find the minimum set of files needed for any codebase task.
        </div>
        <div
          style={{
            marginTop: "60px",
            color: "#333",
            fontSize: "22px",
            fontFamily: "monospace",
          }}
        >
          mincontext.dev
        </div>
      </div>
    ),
    { ...size }
  );
}
