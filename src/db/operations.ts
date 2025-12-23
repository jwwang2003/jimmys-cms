import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from './index';
import { user as users } from '../../auth-schema';

type UserRole = "admin" | "creator" | "user" | "guest";

// Create a new user
export async function createUser(username: string, password: string, role: UserRole = "user") {
    const email = `${username}@users.local`;
    await db.insert(users).values({
        id: randomUUID(),
        name: username,
        email,
        username,
        displayUsername: username,
        password,
        role,
    });
}

// Find a user by username
export async function findUserByUsername(username: string) {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
}

// Validate user login
export async function validateLogin(username: string, password: string) {
    const user = await findUserByUsername(username);
    if (user && user.password === password) {
        return user;
    }
    return null;
}
