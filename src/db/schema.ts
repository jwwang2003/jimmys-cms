import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Define the users table
export const users = sqliteTable('users', {
    id: integer('id').primaryKey(),
    username: text('username').notNull(), 
    password: text('password').notNull(),
    role: text('role').notNull(), // Roles: admin, creator, user, guest
});
