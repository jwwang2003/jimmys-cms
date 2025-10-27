import { Metadata } from "next";
import { desc } from "drizzle-orm";

import { db } from "@/db";
import { user as userTable } from "@/db/schema/auth-schema";
import { UserDirectoryTable } from "@/components/server-only/UserDirectoryTable";

export const metadata: Metadata = {
  title: "User Directory (Server)",
  description: "Server-rendered view of all Better Auth users.",
};

export const runtime = "nodejs";
export const revalidate = 0; // always fetch the freshest data

type UserRecord = typeof userTable.$inferSelect;

async function getUsers(): Promise<UserRecord[]> {
  return db.select().from(userTable).orderBy(desc(userTable.createdAt));
}

export default async function ServerUsersPage() {
  const users = await getUsers();
  const serializedUsers = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: !!user.emailVerified,
    createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
    updatedAt: user.updatedAt ? new Date(user.updatedAt).toISOString() : null,
  }));

  return <UserDirectoryTable users={serializedUsers} />;
}
