package api

import (
	"go-parser/env"
	"net/http"

	"github.com/gin-gonic/gin"
)

func Health(router *gin.RouterGroup) {
	router.GET("/health", func(ctx *gin.Context) {
		ctx.JSON(http.StatusOK, gin.H{
			"version": env.VERSION,
		})
	})
}
