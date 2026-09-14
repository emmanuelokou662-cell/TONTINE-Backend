import mongoose, { Schema, Document, Types } from 'mongoose';

export interface INotification extends Document {
  _id: Types.ObjectId;
  id_notification: string;
  id_utilisateur: Types.ObjectId;
  id_groupe?: Types.ObjectId | null;
  type: string;
  message: string;
  lue: boolean;
  envoyee_push: boolean;
  created_at: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    id_utilisateur: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    id_groupe: { type: Schema.Types.ObjectId, ref: 'Group', default: null, index: true },
    type: { type: String, required: true },
    message: { type: String, required: true },
    lue: { type: Boolean, default: false },
    envoyee_push: { type: Boolean, default: false }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: any) => {
        ret.id_notification = ret._id.toString();
        delete ret.__v;
        return ret;
      }
    }
  }
);

NotificationSchema.virtual('id_notification').get(function (this: INotification) {
  return this._id.toString();
});

export const Notification = mongoose.model<INotification>('Notification', NotificationSchema);
