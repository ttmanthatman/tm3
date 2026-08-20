import bcrypt from "bcryptjs";
import type {
  Account,
  AccountSession,
  Actor,
  PrismaClient
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { z } from "zod";
import type { AccountDTO, AdminLoginLogKind } from "../../shared/types.js";
import type {
  AccountDeletionInput,
  AccountDeletionResult
} from "../services/accountDeletion.js";

type AccountWithActor = Account & { actor: Actor | null };
type LoginLogSession = Pick<
  AccountSession,
  "id" | "deviceKind" | "deviceName" | "ipAddress" | "userAgent"
>;
type AdminAccountAuth = {
  accountId: number;
  sessionId: string;
};
type AdminAccountRequest = FastifyRequest & { auth: AdminAccountAuth };

export type AdminAccountRouteDependencies = {
  prisma: PrismaClient;
  requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  toAccountDto(account: AccountWithActor): AccountDTO;
  updateAccountAvatarFromUpload(
    accountId: number,
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<unknown>;
  writeLoginLog(
    kind: AdminLoginLogKind,
    accountId: number,
    session?: LoginLogSession | null,
    createdAt?: Date
  ): Promise<void>;
  disconnectSessions(sessionIds: string[]): void;
  refreshAccountConnections(account: AccountWithActor): void;
  deleteAccount(input: AccountDeletionInput): Promise<AccountDeletionResult>;
  emitAccountDeleted(payload: {
    action: "account-deleted";
    accountId: number;
    channelIds: number[];
  }): void;
};

const createAccountSchema = z.object({
  username: z
    .string({ message: "用户名不能为空" })
    .min(2, "用户名长度必须为 2–40 位")
    .max(40, "用户名长度必须为 2–40 位")
    .regex(/^[a-zA-Z0-9_.-]+$/, "用户名只能包含英文字母、数字、下划线、点和短横线"),
  password: z
    .string({ message: "密码不能为空" })
    .min(10, "密码长度必须为 10–128 位")
    .max(128, "密码长度必须为 10–128 位"),
  displayName: z
    .string({ message: "显示名不能为空" })
    .trim()
    .min(1, "显示名不能为空")
    .max(80, "显示名最长 80 个字符"),
  isAdmin: z.boolean().optional(),
  canPinMessages: z.boolean().optional()
});

const updateAccountSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  isAdmin: z.boolean().optional(),
  canPinMessages: z.boolean().optional(),
  password: z.string().min(10).max(128).optional(),
  avatarPath: z.string().max(255).nullable().optional()
});

const deletionResponses: Record<
  Exclude<AccountDeletionResult, { deleted: true }>["reason"],
  { statusCode: 400 | 404; message: string }
> = {
  "invalid-account-id": { statusCode: 400, message: "用户编号无效" },
  "current-account": {
    statusCode: 400,
    message: "不能删除当前登录的管理员账号"
  },
  "account-not-found": { statusCode: 404, message: "用户不存在" },
  "last-admin": { statusCode: 400, message: "至少需要保留一个管理员" }
};

export function registerAdminAccountRoutes(
  app: FastifyInstance,
  deps: AdminAccountRouteDependencies
) {
  app.get(
    "/api/admin/accounts",
    { preHandler: deps.requireAdmin },
    async () => {
      const accounts = await deps.prisma.account.findMany({
        where: { isGuest: false },
        include: { actor: true },
        orderBy: { id: "asc" }
      });
      return { accounts: accounts.map((account) => deps.toAccountDto(account)) };
    }
  );

  app.post(
    "/api/admin/accounts",
    { preHandler: deps.requireAdmin },
    async (request, reply) => {
      const parsed = createAccountSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          message: parsed.error.issues[0]?.message || "创建用户资料无效",
          issues: parsed.error.issues
        });
      }
      const body = parsed.data;
      try {
        const passwordHash = await bcrypt.hash(body.password, 12);
        const account = await deps.prisma.$transaction(async (transaction) => {
          const created = await transaction.account.create({
            data: {
              username: body.username,
              passwordHash,
              displayName: body.displayName,
              role: body.isAdmin ? "admin" : "user",
              canPinMessages: !!body.canPinMessages,
              actor: {
                create: {
                  kind: "human",
                  username: body.username,
                  displayName: body.displayName
                }
              }
            },
            include: { actor: true }
          });
          const publicChannels = await transaction.channel.findMany({
            where: { isPrivate: false },
            select: { id: true }
          });
          if (publicChannels.length) {
            await transaction.channelMember.createMany({
              data: publicChannels.map((channel) => ({
                channelId: channel.id,
                accountId: created.id,
                role: "member"
              })),
              skipDuplicates: true
            });
          }
          return created;
        });
        return { success: true, account: deps.toAccountDto(account) };
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          return reply
            .code(409)
            .send({ success: false, message: "用户名已存在" });
        }
        request.log.error({ err: error }, "创建管理员账号失败");
        throw error;
      }
    }
  );

  app.patch(
    "/api/admin/accounts/:id",
    { preHandler: deps.requireAdmin },
    async (request, reply) => {
      const auth = (request as AdminAccountRequest).auth;
      const id = Number((request.params as { id: string }).id);
      const body = updateAccountSchema.parse(request.body);
      const current = await deps.prisma.account.findUnique({
        where: { id },
        include: { actor: true }
      });
      if (!current) {
        return reply
          .code(404)
          .send({ success: false, message: "用户不存在" });
      }
      if (body.isAdmin === false) {
        if (id === auth.accountId) {
          return reply
            .code(400)
            .send({ success: false, message: "不能取消自己的管理员权限" });
        }
        const otherAdmins = await deps.prisma.account.count({
          where: { role: "admin", id: { not: id } }
        });
        if (!otherAdmins) {
          return reply
            .code(400)
            .send({ success: false, message: "至少需要保留一个管理员" });
        }
      }
      const updated = await deps.prisma.account.update({
        where: { id },
        data: {
          displayName: body.displayName,
          avatarPath:
            body.avatarPath === undefined ? undefined : body.avatarPath || null,
          role:
            body.isAdmin === undefined
              ? undefined
              : body.isAdmin
                ? "admin"
                : "user",
          canPinMessages: body.canPinMessages,
          passwordHash: body.password
            ? await bcrypt.hash(body.password, 12)
            : undefined,
          actor:
            body.displayName || body.avatarPath !== undefined
              ? {
                  update: {
                    displayName: body.displayName,
                    avatarPath:
                      body.avatarPath === undefined
                        ? undefined
                        : body.avatarPath || null
                  }
                }
              : undefined
        },
        include: { actor: true }
      });
      if (body.password) {
        const sessionsToRevoke = await deps.prisma.accountSession.findMany({
          where: {
            accountId: id,
            revokedAt: null,
            ...(id === auth.accountId ? { id: { not: auth.sessionId } } : {})
          },
          select: {
            id: true,
            deviceKind: true,
            deviceName: true,
            ipAddress: true,
            userAgent: true
          }
        });
        const revokedAt = new Date();
        await deps.prisma.accountSession.updateMany({
          where: { id: { in: sessionsToRevoke.map((session) => session.id) } },
          data: { revokedAt }
        });
        await Promise.all(
          sessionsToRevoke.map((session) =>
            deps.writeLoginLog("session_revoked", id, session, revokedAt)
          )
        );
        deps.disconnectSessions(
          sessionsToRevoke.map((session) => session.id)
        );
      }
      deps.refreshAccountConnections(updated);
      return { success: true, account: deps.toAccountDto(updated) };
    }
  );

  app.delete(
    "/api/admin/accounts/:id",
    { preHandler: deps.requireAdmin },
    async (request, reply) => {
      const auth = (request as AdminAccountRequest).auth;
      const targetAccountId = Number((request.params as { id: string }).id);
      const result = await deps.deleteAccount({
        currentAccountId: auth.accountId,
        targetAccountId
      });
      if (!result.deleted) {
        const response = deletionResponses[result.reason];
        return reply
          .code(response.statusCode)
          .send({ success: false, message: response.message });
      }

      deps.disconnectSessions(result.sessionIds);
      deps.emitAccountDeleted({
        action: "account-deleted",
        accountId: result.accountId,
        channelIds: result.channelIds
      });
      return { success: true };
    }
  );

  app.post(
    "/api/admin/accounts/:id/avatar",
    { preHandler: deps.requireAdmin },
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      return deps.updateAccountAvatarFromUpload(id, request, reply);
    }
  );
}
