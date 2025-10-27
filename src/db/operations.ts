import { db } from './index';
import { users } from './schema/schema';
import { eq } from 'drizzle-orm';

// Create a new user
export async function createUser(username: string, password: string, role: string) {
    await db.insert(users).values({ username, password, role });
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
