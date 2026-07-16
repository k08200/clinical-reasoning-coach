from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, configured_provider_model
from app.models.model_release_clinical_review import ModelReleaseClinicalReview
from app.models.user import User


def required_model_release_clinical_reviewers(settings: Settings) -> int:
    """Model releases always need two independent clinician attestations."""
    return max(2, settings.clinical_review_minimum_distinct_reviewers)


async def current_model_release_clinical_reviews(
    db: AsyncSession,
    settings: Settings,
) -> list[ModelReleaseClinicalReview]:
    reviews = list(
        (
            await db.scalars(
                select(ModelReleaseClinicalReview)
                .join(User, ModelReleaseClinicalReview.reviewer_user_id == User.id)
                .where(
                    ModelReleaseClinicalReview.provider == settings.llm_provider.lower(),
                    ModelReleaseClinicalReview.model == configured_provider_model(settings),
                    ModelReleaseClinicalReview.evaluation_sha256
                    == settings.model_release_evaluation_sha256.strip().lower(),
                )
            )
        ).all()
    )
    reviewer_ids = {review.reviewer_user_id for review in reviews}
    users = {
        user.id: user
        for user in (
            await db.scalars(select(User).where(User.id.in_(reviewer_ids)))
        ).all()
    }
    return [
        review
        for review in reviews
        if users.get(review.reviewer_user_id)
        and users[review.reviewer_user_id].reviewer_credential_current
    ]
