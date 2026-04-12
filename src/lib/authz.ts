import { redirect } from "next/navigation";

import { getCurrentSession } from "./session";

export async function requireCmsSession() {
    const session = await getCurrentSession();
    if (!session) {
        redirect("/login");
    }
    return session;
}

export function canEdit(role: string) {
    return role === "admin" || role === "user";
}

export async function requireEditorSession() {
    const session = await requireCmsSession();
    if (!canEdit(session.role)) {
        throw new Error("Guests have read-only access");
    }
    return session;
}
