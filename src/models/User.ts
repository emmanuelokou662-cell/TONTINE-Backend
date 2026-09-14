import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IUser extends Document {
  _id: Types.ObjectId;
  id_utilisateur: string;
  nom: string;
  prenom: string;
  contact_paiement: string;
  email: string;
  email_verifie: boolean;
  code_pin: string;
  ville: string;
  photo_profil_url: string;
  tentatives_echouees: number;
  blocage_jusqu_a?: Date | null;
  theme_preference: string;
  push_subscription?: string | null;
  created_at: Date;
  updated_at: Date;
}

const UserSchema = new Schema<IUser>(
  {
    nom: { type: String, required: true, trim: true },
    prenom: { type: String, required: true, trim: true },
    contact_paiement: { type: String, required: true, unique: true, trim: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    email_verifie: { type: Boolean, default: false },
    code_pin: { type: String, required: true },
    ville: { type: String, required: true, trim: true },
    photo_profil_url: { type: String, required: true },
    tentatives_echouees: { type: Number, default: 0 },
    blocage_jusqu_a: { type: Date, default: null },
    theme_preference: { type: String, default: 'clair' },
    push_subscription: { type: String, default: null }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: any) => {
        ret.id_utilisateur = ret._id.toString();
        delete ret.__v;
        return ret;
      }
    }
  }
);

UserSchema.virtual('id_utilisateur').get(function (this: IUser) {
  return this._id.toString();
});

export const User = mongoose.model<IUser>('User', UserSchema);
