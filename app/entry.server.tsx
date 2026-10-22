import { renderToReadableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { type EntryContext } from "react-router";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";

export const streamTimeout = 10000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const waitForAllReady = isbot(userAgent ?? "");

  const abortController = new AbortController();
  const abortTimer = setTimeout(
    () => abortController.abort(),
    streamTimeout + 1000,
  );

  const body = await renderToReadableStream(
    <ServerRouter context={reactRouterContext} url={request.url} />,
    {
      signal: abortController.signal,
      onError(error) {
        responseStatusCode = 500;
        console.error(error);
      },
    },
  );

  if (waitForAllReady) {
    await body.allReady;
  }

  clearTimeout(abortTimer);
  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
