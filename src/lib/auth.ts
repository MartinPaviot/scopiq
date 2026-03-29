import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  basePath: "/api/auth",

  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      enabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    },
  },

  user: {
    additionalFields: {
      workspaceId: {
        type: "string",
        required: false,
        input: false,
      },
    },
  },

  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const name = user.name || user.email.split("@")[0];
          const baseSlug = slugify(name);
          const slug = `${baseSlug}-${user.id.slice(-6)}`;

          const workspace = await prisma.workspace.create({
            data: {
              name: `${name}'s Workspace`,
              slug,
            },
          });

          await prisma.user.update({
            where: { id: user.id },
            data: { workspaceId: workspace.id },
          });
        },
      },
    },
  },
});

export type Auth = typeof auth;
