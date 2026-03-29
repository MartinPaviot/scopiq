import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function createContext(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user) {
    return { userId: null, workspaceId: null, workspace: null };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { workspace: true },
  });

  if (!user) {
    return { userId: null, workspaceId: null, workspace: null };
  }

  return {
    userId: user.id,
    workspaceId: user.workspaceId,
    workspace: user.workspace,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
