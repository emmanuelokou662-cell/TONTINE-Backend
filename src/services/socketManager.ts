import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { env } from '../config/env';
import { verifyAccessToken, JwtUserPayload } from '../utils/security';

export interface AuthenticatedSocket extends Socket {
  data: {
    user?: JwtUserPayload;
  };
}

/**
 * Cerveau Global Socket.IO Backend pour TONTINE PWA
 * Gère les connexions, salons (rooms), événements temps réel et diffusions
 */
class SocketManager {
  private io: SocketIOServer | null = null;

  /**
   * Initialise le serveur Socket.IO attaché au serveur HTTP
   */
  public init(httpServer: HttpServer): SocketIOServer {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: (origin, callback) => {
          if (!origin) return callback(null, true);
          const normalized = origin.replace(/\/+$/, '');
          if (
            env.ALLOWED_ORIGINS_LIST.includes('*') ||
            env.ALLOWED_ORIGINS_LIST.includes(normalized) ||
            env.ALLOWED_ORIGINS_LIST.includes(origin)
          ) {
            return callback(null, true);
          }
          if (env.NODE_ENV === 'development' && /^http:\/\/localhost(:\d+)?$/.test(origin)) {
            return callback(null, true);
          }
          return callback(null, true); // Tolérant pour WebSockets
        },
        methods: ['GET', 'POST'],
        credentials: true
      },
      pingTimeout: 20000,
      pingInterval: 25000,
      transports: ['websocket', 'polling']
    });

    // Middleware d'authentification Socket.IO par JWT Bearer Token
    this.io.use((socket: AuthenticatedSocket, next) => {
      try {
        const token =
          socket.handshake.auth?.token ||
          socket.handshake.headers?.authorization?.replace('Bearer ', '');

        if (token) {
          try {
            const decoded = verifyAccessToken(token);
            socket.data.user = decoded;
          } catch (jwtErr) {
            console.warn(`⚠️ [Socket.IO] Jeton JWT invalide pour le socket ${socket.id}`);
          }
        }
        next();
      } catch (err: any) {
        next();
      }
    });

    // Gestion des événements de connexion
    this.io.on('connection', (socket: AuthenticatedSocket) => {
      const user = socket.data.user;
      const userIdentifier = user ? `${user.email || ''} (${user.id_utilisateur})` : 'Anonyme';
      console.log(`⚡ [Socket.IO] Client connecté : ${socket.id} — Utilisateur : ${userIdentifier}`);

      // Si l'utilisateur est authentifié, le rattacher à son salon privé
      if (user?.id_utilisateur) {
        socket.join(`user:${user.id_utilisateur}`);
        console.log(`📌 [Socket.IO] Utilisateur ${user.id_utilisateur} a rejoint son salon privé user:${user.id_utilisateur}`);
      }

      // Événement : Rejoindre le salon d'un groupe de tontine
      socket.on('join_group', (groupId: string) => {
        if (!groupId) return;
        const roomName = `group:${groupId}`;
        socket.join(roomName);
        console.log(`👥 [Socket.IO] Socket ${socket.id} a rejoint le groupe ${roomName}`);
        socket.emit('joined_group', { groupId, timestamp: new Date().toISOString() });
      });

      // Événement : Quitter le salon d'un groupe
      socket.on('leave_group', (groupId: string) => {
        if (!groupId) return;
        const roomName = `group:${groupId}`;
        socket.leave(roomName);
        console.log(`👋 [Socket.IO] Socket ${socket.id} a quitté le groupe ${roomName}`);
      });

      // Ping / Pong pour test de latence
      socket.on('ping_server', () => {
        socket.emit('pong_client', { timestamp: Date.now() });
      });

      socket.on('disconnect', (reason) => {
        console.log(`🔌 [Socket.IO] Client déconnecté : ${socket.id} (${reason})`);
      });
    });

    console.log('🧠 [Socket.IO] Cerveau temps réel initialisé avec succès.');
    return this.io;
  }

  /**
   * Récupère l'instance Socket.IO active
   */
  public getIO(): SocketIOServer {
    if (!this.io) {
      throw new Error('Socket.IO n\'est pas encore initialisé. Appelez socketManager.init(httpServer) au démarrage.');
    }
    return this.io;
  }

  // ============================================================================
  // ÉMETTEURS TYPÉS POUR DIFFUSION TEMPS RÉEL (BROADCASTS)
  // ============================================================================

  /**
   * Émettre un événement à un utilisateur spécifique
   */
  public emitToUser(userId: string, event: string, payload: any): void {
    if (!this.io) return;
    this.io.to(`user:${userId}`).emit(event, payload);
  }

  /**
   * Émettre un événement à tous les membres d'un groupe de tontine
   */
  public emitToGroup(groupId: string, event: string, payload: any): void {
    if (!this.io) return;
    this.io.to(`group:${groupId}`).emit(event, payload);
  }

  /**
   * Notification en direct d'une nouvelle cotisation déclarée
   */
  public broadcastPaymentDeclared(groupId: string, transaction: any): void {
    this.emitToGroup(groupId, 'payment:declared', {
      groupId,
      transaction,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Notification en direct de la validation d'une cotisation
   */
  public broadcastPaymentValidated(groupId: string, transaction: any): void {
    this.emitToGroup(groupId, 'payment:validated', {
      groupId,
      transaction,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Notification en direct du rejet d'une cotisation
   */
  public broadcastPaymentRejected(groupId: string, transaction: any): void {
    this.emitToGroup(groupId, 'payment:rejected', {
      groupId,
      transaction,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Notification en direct de la distribution de la cagnotte d'un tour
   */
  public broadcastTourDistributed(groupId: string, tour: any): void {
    this.emitToGroup(groupId, 'tour:distributed', {
      groupId,
      tour,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Notification en direct de la clôture et rotation d'un cycle
   */
  public broadcastCycleCompleted(groupId: string, newCycle: any): void {
    this.emitToGroup(groupId, 'cycle:completed', {
      groupId,
      newCycle,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Notification en direct d'un nouveau membre ayant rejoint le groupe
   */
  public broadcastMemberJoined(groupId: string, memberData: any): void {
    this.emitToGroup(groupId, 'member:joined', {
      groupId,
      member: memberData,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Notification en direct de la mise à jour d'un membre (ex: admin secondaire)
   */
  public broadcastMemberUpdated(groupId: string, memberData: any): void {
    this.emitToGroup(groupId, 'member:updated', {
      groupId,
      member: memberData,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Notification en direct du retrait d'un membre
   */
  public broadcastMemberRemoved(groupId: string, memberId: string): void {
    this.emitToGroup(groupId, 'member:removed', {
      groupId,
      memberId,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Notification en direct d'un nouveau message de chat de groupe
   */
  public broadcastNewMessage(groupId: string, message: any): void {
    this.emitToGroup(groupId, 'chat:new_message', {
      groupId,
      message,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Notification en direct envoyée à un utilisateur
   */
  public broadcastNotification(userId: string, notification: any): void {
    this.emitToUser(userId, 'notification:new', {
      notification,
      timestamp: new Date().toISOString()
    });
  }
}

export const socketManager = new SocketManager();
