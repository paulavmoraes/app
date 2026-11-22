import { HTTPException } from "hono/http-exception";

export const badRequest = (message: string) => new HTTPException(400, { message });
export const notFound = (message = "Not found") => new HTTPException(404, { message });
export const conflict = (message: string) => new HTTPException(409, { message });
export const unauthorized = () => new HTTPException(401, { message: "Not signed in" });
