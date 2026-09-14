import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IMessage extends Document {
  _id: Types.ObjectId;
  id_message: string;
  id_groupe: Types.ObjectId;
  id_expediteur: Types.ObjectId;
  id_destinataire: Types.ObjectId;
  contenu: string;
  lu: boolean;
  created_at: Date;
}

const MessageSchema = new Schema<IMessage>(
  {
    id_groupe: { type: Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
    id_expediteur: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    id_destinataire: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    contenu: { type: String, required: true },
    lu: { type: Boolean, default: false }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: any) => {
        ret.id_message = ret._id.toString();
        delete ret.__v;
        return ret;
      }
    }
  }
);

MessageSchema.virtual('id_message').get(function (this: IMessage) {
  return this._id.toString();
});

export const Message = mongoose.model<IMessage>('Message', MessageSchema);
