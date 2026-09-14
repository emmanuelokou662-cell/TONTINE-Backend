import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ITransaction extends Document {
  _id: Types.ObjectId;
  id_transaction: string;
  id_membre_groupe: Types.ObjectId;
  id_tour?: Types.ObjectId | null;
  type: 'depot' | 'retrait';
  montant: number;
  moyen_paiement: 'MTN_Money' | 'Wave';
  numero_tx_operateur: string;
  preuve_capture_url?: string | null;
  statut: 'en_attente' | 'confirme' | 'rejete' | 'reporte';
  motif_rejet?: string | null;
  id_validateur?: Types.ObjectId | null;
  created_at: Date;
  synced_at?: Date | null;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    id_membre_groupe: { type: Schema.Types.ObjectId, ref: 'GroupMember', required: true, index: true },
    id_tour: { type: Schema.Types.ObjectId, ref: 'Tour', default: null },
    type: { type: String, enum: ['depot', 'retrait'], required: true },
    montant: { type: Number, required: true },
    moyen_paiement: { type: String, enum: ['MTN_Money', 'Wave'], required: true },
    numero_tx_operateur: { type: String, required: true, unique: true, index: true },
    preuve_capture_url: { type: String, default: null },
    statut: {
      type: String,
      enum: ['en_attente', 'confirme', 'rejete', 'reporte'],
      default: 'en_attente'
    },
    motif_rejet: { type: String, default: null },
    id_validateur: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    synced_at: { type: Date, default: null }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: any) => {
        ret.id_transaction = ret._id.toString();
        delete ret.__v;
        return ret;
      }
    }
  }
);

TransactionSchema.virtual('id_transaction').get(function (this: ITransaction) {
  return this._id.toString();
});

export const Transaction = mongoose.model<ITransaction>('Transaction', TransactionSchema);
