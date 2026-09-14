import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IGroupMember extends Document {
  _id: Types.ObjectId;
  id: string;
  id_utilisateur: Types.ObjectId;
  id_groupe: Types.ObjectId;
  role: 'admin_principal' | 'admin_secondaire' | 'membre';
  statut: 'actif' | 'suspecte' | 'retire';
  credit_reporte: number;
  retards_consecutifs: number;
  date_adhesion: Date;
}

const GroupMemberSchema = new Schema<IGroupMember>(
  {
    id_utilisateur: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    id_groupe: { type: Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
    role: {
      type: String,
      enum: ['admin_principal', 'admin_secondaire', 'membre'],
      default: 'membre'
    },
    statut: {
      type: String,
      enum: ['actif', 'suspecte', 'retire'],
      default: 'actif'
    },
    credit_reporte: { type: Number, default: 0.0 },
    retards_consecutifs: { type: Number, default: 0 },
    date_adhesion: { type: Date, default: Date.now }
  },
  {
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: any) => {
        ret.id = ret._id.toString();
        delete ret.__v;
        return ret;
      }
    }
  }
);

// Unicité : Un utilisateur ne peut être inscrit qu'une seule fois dans un même groupe
GroupMemberSchema.index({ id_utilisateur: 1, id_groupe: 1 }, { unique: true });

GroupMemberSchema.virtual('id').get(function (this: IGroupMember) {
  return this._id.toString();
});

export const GroupMember = mongoose.model<IGroupMember>('GroupMember', GroupMemberSchema);
