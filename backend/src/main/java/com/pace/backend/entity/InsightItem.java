package com.pace.backend.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "insight_item")
@Getter
@Setter
@NoArgsConstructor
public class InsightItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "category", nullable = false, length = 32)
    private String category;

    @Column(name = "text_en", nullable = false, length = 500)
    private String textEn;

    @Column(name = "text_ko", nullable = false, length = 500)
    private String textKo;

    @Column(name = "active", nullable = false)
    private boolean active;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;
}
