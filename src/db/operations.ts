import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "./index";
import { hashPassword, verifyPassword } from "@/lib/password";
import { user as users } from "../../auth-schema";

export type UserRole = "admin" | "creator" | "user" | "guest";

const AUTO_EMAIL_DOMAIN = "users.local";

function buildEmail(username: string) {
    return `${username.toLowerCase()}@${AUTO_EMAIL_DOMAIN}`;
}

function normalizeUsername(value: string) {
    return value.trim();
}

export async function ensureDefaultAdmin() {
    const username = normalizeUsername(process.env.ADMIN_USERNAME || "admin");
    const password = process.env.ADMIN_PASSWORD || "admin";
    const existing = await findUserByUsername(username);
    if (existing) return existing;

    const [created] = await db
        .insert(users)
        .values({
            id: randomUUID(),
            name: username,
            email: buildEmail(username),
            username,
            displayUsername: username,
            password: hashPassword(password),
            role: "admin",
        })
        .returning();

    return created;
}

export async function findUserByUsername(username: string) {
    const normalized = normalizeUsername(username);
    const [user] = await db.select().from(users).where(eq(users.username, normalized));
    return user ?? null;
}

export async function findUserById(id: string) {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user ?? null;
}

export async function registerUser(input: {
    username: string;
    password?: string;
    role: Extract<UserRole, "user" | "guest">;
}) {
    const username = normalizeUsername(input.username);
    const existing = await findUserByUsername(username);
    if (existing) {
        throw new Error("Username is already taken");
    }

    if (username.length < 3) {
        throw new Error("Usernames must be at least 3 characters");
    }

    const password = input.password?.trim() || "";
    if (input.role === "user" && password.length < 6) {
        throw new Error("Users must provide a password with at least 6 characters");
    }

    const storedPassword = password ? hashPassword(password) : "";
    const [created] = await db
        .insert(users)
        .values({
            id: randomUUID(),
            name: username,
            email: buildEmail(username),
            username,
            displayUsername: username,
            password: storedPassword,
            role: input.role,
        })
        .returning();

    return created;
}

export async function createPasswordlessGuest() {
    const username = `guest-${Math.random().toString(36).slice(2, 8)}`;
    const [guest] = await db
        .insert(users)
        .values({
            id: randomUUID(),
            name: username,
            email: buildEmail(username),
            username,
            displayUsername: username,
            password: "",
            role: "guest",
        })
        .returning();
    return guest;
}

export async function validateLogin(username: string, password: string) {
    await ensureDefaultAdmin();
    const user = await findUserByUsername(username);
    if (!user) {
        return null;
    }

    if (user.role === "guest" && !user.password && password.trim() === "") {
        return user;
    }

    if (verifyPassword(user.password, password)) {
        return user;
    }
    return null;
}

export async function listUsersByRole(role: UserRole) {
    return db.select().from(users).where(eq(users.role, role));
}

export async function canMutateForRole(userId: string) {
    const [user] = await db
        .select({ role: users.role })
        .from(users)
        .where(and(eq(users.id, userId)));
    return user?.role === "admin" || user?.role === "user";
}
