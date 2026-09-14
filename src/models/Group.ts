import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IGroup extends Document {
  _id: Types.ObjectId;
  id_groupe: string;
  nom_groupe: string;
  mot_de_passe_groupe: string;
  id_admin_principal: Types.ObjectId;
  id_admin_secondaire?: Types.ObjectId | null;
  periodicite: '1semaine' | '2semaines' | '1mois' | '2mois';
  statut: 'actif' | 'cloture';
  created_at: Date;
}

const GroupSchema = new Schema<IGroup>(
  {
    nom_groupe: { type: String, required: true, trim: true },
    mot_de_passe_groupe: { type: String, required: true },
    id_admin_principal: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    id_admin_secondaire: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    periodicite: {
      type: String,
      enum: ['1semaine', '2semaines', '1mois', '2mois'],
      required: true
    },
    statut: { type: String, enum: ['actif', 'cloture'], default: 'actif' }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: any) => {
        ret.id_groupe = ret._id.toString();
        delete ret.__v;
        return ret;
      }
    }
  }
);

GroupSchema.virtual('id_groupe').get(function (this: IGroup) {
  return this._id.toString();
});

export const Group = mongoose.model<IGroup>('Group', GroupSchema);
