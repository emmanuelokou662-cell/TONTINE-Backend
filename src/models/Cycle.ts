import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ICycle extends Document {
  _id: Types.ObjectId;
  id_cycle: string;
  id_groupe: Types.ObjectId;
  numero_cycle: number;
  montant_cotisation: number;
  date_debut: Date;
  date_fin?: Date | null;
  statut: 'en_cours' | 'termine';
}

const CycleSchema = new Schema<ICycle>(
  {
    id_groupe: { type: Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
    numero_cycle: { type: Number, required: true },
    montant_cotisation: { type: Number, required: true },
    date_debut: { type: Date, default: Date.now },
    date_fin: { type: Date, default: null },
    statut: { type: String, enum: ['en_cours', 'termine'], default: 'en_cours' }
  },
  {
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: any) => {
        ret.id_cycle = ret._id.toString();
        delete ret.__v;
        return ret;
      }
    }
  }
);

CycleSchema.virtual('id_cycle').get(function (this: ICycle) {
  return this._id.toString();
});

export const Cycle = mongoose.model<ICycle>('Cycle', CycleSchema);
